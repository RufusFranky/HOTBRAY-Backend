// hotbray-backend/searchRoutes.js
import express from "express";
import meili from "./meili.js";

const router = express.Router();

/**
 * GET /search?q=...&limit=20&filters=category:Jaguar
 * Full search with fuzzy + partial + synonym support
 */
router.get("/", async (req, res) => {
  const q = (req.query.q || "").toString();
  const limit = parseInt(req.query.limit || "20", 10);
  const filters = req.query.filters || null; // optional Meili filters string

  if (!q || q.trim().length === 0) {
    return res.json({ hits: [] });
  }

  try {
    const index = meili.index("products");

    const searchOptions = {
      limit,
      attributesToHighlight: ["name", "description"],
      matches: true,
      filter: filters || undefined,
      // Meili handles typo tolerance automatically; you can adjust if needed
    };

    const result = await index.search(q, searchOptions);

    return res.json({
      hits: result.hits || [],
      offset: result.offset,
      limit: result.limit,
      estimatedTotalHits: result.estimatedTotalHits,
      processingTimeMs: result.processingTimeMs,
    });
  } catch (err) {
    console.error("search error:", err);
    return res.status(500).json({ error: "Search error" });
  }
});

/**
 * GET /search/suggest?q=...&limit=8
 * Lightweight auto-suggest (returns top matches' names + part_numbers)
 */
router.get("/suggest", async (req, res) => {
  const q = (req.query.q || "").toString();
  const limit = parseInt(req.query.limit || "8", 10);

  if (!q || q.trim().length < 1) {
    return res.json({ suggestions: [] });
  }

  try {
    const index = meili.index("products");
    const result = await index.search(q, {
      limit,
      attributesToCrop: [],
      attributesToHighlight: [],
      attributesToRetrieve: ["id", "name", "part_number", "image", "price"],
    });

    const suggestions = result.hits.map((h) => ({
      id: h.id,
      name: h.name,
      part_number: h.part_number,
      image: h.image,
      price: h.price,
    }));

    return res.json({ suggestions });
  } catch (err) {
    console.error("suggest error:", err);
    return res.status(500).json({ error: "Suggest error" });
  }
});

export default router;
