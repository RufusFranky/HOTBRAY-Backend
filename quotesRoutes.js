// hotbray-backend/quotesRoutes.js
import express from "express";
import crypto from "crypto";
import pool from "./db.js";

const router = express.Router();

/**
 * Helper: generate unique quote number (Q-YYYYMMDD-XXXX)
 */
function generateQuoteNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `Q-${y}${m}${day}-${suffix}`;
}

/**
 * Helper: generate token (used for public link)
 */
function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * POST /quotes/create
 * body: {
 *   user_id?: string,
 *   user_email?: string,
 *   name?: string,
 *   note?: string,
 *   items: [{ part_number, qty, product_id?, name?, price?, mapped_to? }, ...]
 * }
 */
router.post("/create", async (req, res) => {
  const { user_id = null, user_email = null, name = null, note = null, items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // create quote
    const quoteNumber = generateQuoteNumber();
    const token = generateToken();

    const insertQuoteText = `INSERT INTO quotes (quote_number, token, user_id, user_email, name, note)
                             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
    const quoteRes = await client.query(insertQuoteText, [
      quoteNumber,
      token,
      user_id,
      user_email,
      name,
      note,
    ]);

    const quote = quoteRes.rows[0];

    // insert items
    const insertItemText = `INSERT INTO quote_items
      (quote_id, product_id, part_number, name, price, qty, mapped_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`;

    const insertedItems = [];
    for (const it of items) {
      const product_id = it.product_id || null;
      const part_number = (it.part_number || it.part || "").toString().trim().toUpperCase();
      const nameVal = it.name || null;
      const priceVal = it.price !== undefined ? it.price : null;
      const qtyVal = parseInt(it.qty || it.qty === 0 ? it.qty : 1, 10) || 1;
      const mapped_to = it.mapped_to || null;

      const r = await client.query(insertItemText, [
        quote.id,
        product_id,
        part_number,
        nameVal,
        priceVal,
        qtyVal,
        mapped_to,
      ]);

      insertedItems.push(r.rows[0]);
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
      quote: {
        id: quote.id,
        quote_number: quote.quote_number,
        token: quote.token,
        user_id: quote.user_id,
        user_email: quote.user_email,
        name: quote.name,
        note: quote.note,
        created_at: quote.created_at,
      },
      items: insertedItems,
      public_link: `/quotes/${token}`,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("quotes create error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /quotes/user/:userId
 * returns quotes for a given user_id
 */
router.get("/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const q = `SELECT q.id, q.quote_number, q.token, q.name, q.user_email, q.created_at,
                    (SELECT COUNT(*) FROM quote_items i WHERE i.quote_id = q.id) AS item_count
               FROM quotes q
               WHERE q.user_id = $1
               ORDER BY q.created_at DESC
               LIMIT 200`;
    const r = await pool.query(q, [userId]);
    return res.json({ quotes: r.rows });
  } catch (err) {
    console.error("quotes user error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /quotes/view/:token
 * public view of quote by token (used by emailed link)
 */
router.get("/view/:token", async (req, res) => {
  const { token } = req.params;
  try {
    const qr = await pool.query("SELECT * FROM quotes WHERE token = $1 LIMIT 1", [token]);
    if (qr.rows.length === 0) {
      return res.status(404).json({ error: "Quote not found" });
    }
    const quote = qr.rows[0];

    const itemsR = await pool.query("SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY id", [quote.id]);
    return res.json({
      quote,
      items: itemsR.rows,
    });
  } catch (err) {
    console.error("quotes view error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /quotes/convert-to-cart
 * Accepts { token } OR { quote_id }
 * Returns items array so frontend can add to cart
 */
router.post("/convert-to-cart", async (req, res) => {
  const { token = null, quote_id = null } = req.body;

  try {
    let quoteId = quote_id;

    if (!quoteId && token) {
      const qr = await pool.query("SELECT id FROM quotes WHERE token = $1 LIMIT 1", [token]);
      if (qr.rows.length === 0) return res.status(404).json({ error: "Quote not found" });
      quoteId = qr.rows[0].id;
    }

    if (!quoteId) return res.status(400).json({ error: "token or quote_id required" });

    const itemsR = await pool.query("SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY id", [quoteId]);
    const items = itemsR.rows.map((i) => ({
      id: i.product_id || null,
      part_number: i.part_number,
      name: i.name,
      price: i.price !== null ? parseFloat(i.price) : 0,
      qty: i.qty,
      mapped_to: i.mapped_to || null,
    }));




    return res.json({ items });
  } catch (err) {
    console.error("convert-to-cart error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /quotes/:id
 * Deletes a quote and its items
 */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Check if the quote exists
    const check = await pool.query(
      "SELECT id FROM quotes WHERE id = $1 LIMIT 1",
      [id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Quote not found" });
    }

    // Delete quote items first
    await pool.query(
      "DELETE FROM quote_items WHERE quote_id = $1",
      [id]
    );

    // Delete the quote
    await pool.query(
      "DELETE FROM quotes WHERE id = $1",
      [id]
    );

    return res.json({ success: true, message: "Quote deleted successfully" });

  } catch (err) {
    console.error("quotes delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


export default router;
