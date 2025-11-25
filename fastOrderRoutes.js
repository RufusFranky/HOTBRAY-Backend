import express from "express";
import pool from "./db.js";

const router = express.Router();

/* --------------------------------------------------
   Helper: Normalize part numbers
-------------------------------------------------- */
function normalize(pn) {
  return pn ? pn.toString().trim().toUpperCase() : "";
}

/* --------------------------------------------------
   DB Query: Find exact part OR alternative
-------------------------------------------------- */
async function findProductByPartNumber(pn) {
  const part = normalize(pn);

  // 1️⃣ Check if part exists
  const existing = await pool.query(
    "SELECT * FROM products WHERE UPPER(part_number) = $1 LIMIT 1",
    [part]
  );

  if (existing.rows.length > 0) {
    return {
      product: existing.rows[0],
      is_obsolete: false,
      alternative: null,
    };
  }

  // 2️⃣ Check if this part is obsolete and mapped to an alternative
  const obsolete = await pool.query(
    `SELECT p.*, a.part_number AS alternative_part_number
     FROM obsolete_map o
     JOIN products p ON p.part_number = o.original_part
     JOIN products a ON a.part_number = o.alternative_part
     WHERE UPPER(o.original_part) = $1
     LIMIT 1`,
    [part]
  );

  if (obsolete.rows.length > 0) {
    return {
      product: obsolete.rows[0],
      is_obsolete: true,
      alternative: obsolete.rows[0].alternative_part_number,
    };
  }

  // 3️⃣ No match
  return null;
}

/* --------------------------------------------------
   SINGLE LOOKUP
   GET /fast-order/single?part=ABC123
-------------------------------------------------- */
router.get("/single", async (req, res) => {
  const { part } = req.query;

  if (!part)
    return res.status(400).json({ error: "Part number is required." });

  try {
    const result = await findProductByPartNumber(part);

    if (!result) {
      return res.status(404).json({
        item: {
          part_number: normalize(part),
          qty: 1,
          product: null,
          message: "Not found",
        },
      });
    }

    const responseItem = {
      part_number: normalize(part),
      qty: 1,
      product: result.product,
      mapped_to: result.is_obsolete ? result.alternative : null,
      message: result.is_obsolete ? "Obsolete — using alternative part" : null,
    };

    res.json({ item: responseItem });
  } catch (err) {
    console.error("Single lookup error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* --------------------------------------------------
   BULK VALIDATION
   POST /fast-order/bulk-validate
   body: { items: [ {part_number, qty}, ... ] }
-------------------------------------------------- */
router.post("/bulk-validate", async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items))
    return res.status(400).json({ error: "Items must be an array." });

  const processed = [];

  try {
    for (const item of items.slice(0, 100)) {
      const pn = normalize(item.part_number);
      const qty = parseInt(item.qty, 10) || 1;

      const result = await findProductByPartNumber(pn);

      if (!result) {
        processed.push({
          part_number: pn,
          qty,
          product: null,
          message: "Not found",
        });
        continue;
      }

      processed.push({
        part_number: pn,
        qty,
        product: result.product,
        mapped_to: result.is_obsolete ? result.alternative : null,
        message: result.is_obsolete
          ? "Obsolete — using alternative part"
          : null,
      });
    }

    res.json({ processed });
  } catch (err) {
    console.error("Bulk validate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* --------------------------------------------------
   EXPORT ROUTER
-------------------------------------------------- */
export default router;
