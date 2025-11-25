import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db.js";
import fastOrderRoutes from "./fastOrderRoutes.js";
import quotesRoutes from "./quotesRoutes.js"; // <-- NEW
import searchRoutes from "./searchRoutes.js";


dotenv.config();

const app = express();

// Enable CORS (so both localhost and Vercel frontend work)
app.use(
  cors({
    origin: [
      "http://localhost:3000", // local dev
      "https://dgstech-frontend.vercel.app", // production frontend
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());
app.use("/fast-order", fastOrderRoutes);
app.use("/quotes", quotesRoutes); // <-- NEW (mount quotes router)
app.use("/search", searchRoutes)

// Test route
app.get("/", (req, res) => {
  res.send("Backend is running...");
});

// Get all products
app.get("/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Database error" });
  }
});

// Get single product by ID
app.get("/products/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM products WHERE id = $1", [
      id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching single product:", error);
    res.status(500).json({ error: "Database error" });
  }
});

// Debug route to test DB connection
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ message: "Connected successfully!", time: result.rows[0].now });
  } catch (error) {
    console.error("DB connection error:", error);
    res
      .status(500)
      .json({ error: "Failed to connect to database", details: error.message });
  }
});

/**
 * FAST ORDER endpoints (single lookup + bulk validate)
 * - /fast-order/single?part=PARTNUMBER
 * - POST /fast-order/bulk-validate { items: [{ part_number, qty }] }
 */

// Helper: normalize part number
function normalizePart(s) {
  if (!s) return "";
  return s.toString().trim().toUpperCase();
}
// SINGLE lookup
app.get("/fast-order/single", async (req, res) => {
  try {
    const partRaw = req.query.part;
    if (!partRaw) return res.status(400).json({ error: "part query required" });
    const part = normalizePart(partRaw);

    const q = `SELECT * FROM products WHERE UPPER(part_number) = $1 LIMIT 1`;
    const r = await pool.query(q, [part]);

    if (r.rows.length === 0) {
      return res.json({
        item: {
          part_number: part,
          qty: 1,
          product: null,
          message: "Not found",
        },
      });
    }

    let product = r.rows[0];

    // If product has obsolete flag and alternative, try to fetch alternative
    if (product.is_obsolete && product.alternative_part_number) {
      try {
        const altPN = product.alternative_part_number.toString().toUpperCase();
        const altQ = await pool.query(
          `SELECT * FROM products WHERE UPPER(part_number) = $1 LIMIT 1`,
          [altPN]
        );
        if (altQ.rows.length > 0) {
          // return the alternative product but also indicate mapping
          product = altQ.rows[0];
          product.mapped_from = part;
        }
      } catch (e) {
        // ignore alt fetch errors and just return original
      }
    }

    const resp = {
      part_number: part,
      qty: 1,
      product: {
        id: product.id,
        part_number: product.part_number,
        name: product.name,
        price: product.price,
        image: product.image,
        is_obsolete: product.is_obsolete || false,
        alternative_part_number: product.alternative_part_number || null,
      },
    };

    return res.json({ item: resp });
  } catch (err) {
    console.error("fast-order single error", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
});

// BULK validate
app.post("/fast-order/bulk-validate", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !Array.isArray(payload.items)) {
      return res.status(400).json({ error: "items array required" });
    }

    const raw = payload.items.slice(0, 100);

    // Normalize and merge duplicates
    const merged = {};
    for (const r of raw) {
      const pn = normalizePart(r.part_number || r.part || r.PartNumber || "");
      const q = r.qty ? parseInt(r.qty, 10) || 1 : 1;
      if (!pn) continue;
      if (!merged[pn]) merged[pn] = { part_number: pn, qty: 0 };
      merged[pn].qty += q;
    }
    const list = Object.values(merged);

    if (list.length === 0) {
      return res.status(400).json({ error: "No valid part_number found" });
    }

    // Query DB for all parts in one query
    const params = list.map((l) => l.part_number);
    const placeholders = params.map((_, i) => `$${i + 1}`).join(",");
    const queryText = `SELECT * FROM products WHERE UPPER(part_number) IN (${placeholders})`;
    const dbRes = await pool.query(queryText, params);

    // map part_number -> product
    const productMap = {};
    for (const row of dbRes.rows) {
      productMap[row.part_number.toUpperCase()] = row;
    }

    const processed = [];
    const invalidRows = [];

    for (const item of list) {
      const pn = item.part_number;
      const qty = item.qty;
      const found = productMap[pn];
      if (!found) {
        invalidRows.push({ part_number: pn, qty, reason: "not found" });
        processed.push({
          part_number: pn,
          qty,
          product: null,
          message: "Not found",
        });
        continue;
      }

      let product = found;
      let mapped_to = null;

      if (product.is_obsolete && product.alternative_part_number) {
        try {
          const altPN = product.alternative_part_number
            .toString()
            .toUpperCase();
          const altQ = await pool.query(
            `SELECT * FROM products WHERE UPPER(part_number) = $1 LIMIT 1`,
            [altPN]
          );
          if (altQ.rows.length > 0) {
            product = altQ.rows[0];
            mapped_to = product.part_number;
          }
        } catch (e) {
          // ignore alt fetch errors
        }
      }

      processed.push({
        part_number: pn,
        qty,
        product: {
          id: product.id,
          part_number: product.part_number,
          name: product.name,
          price: product.price,
          image: product.image,
          is_obsolete: product.is_obsolete || false,
          alternative_part_number: product.alternative_part_number || null,
        },
        mapped_to,
      });
    }

    return res.json({
      processed,
      invalidRows,
      totalInput: raw.length,
      totalProcessed: processed.length,
    });
  } catch (err) {
    console.error("fast-order bulk validate error", err);
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
});



// Render’s dynamic port (keeps your previous behavior)
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running and listening on port ${PORT}`);
});
