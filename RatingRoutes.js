import express from "express";
import pool from "./db.js";
 
const router = express.Router();
 
// SAVE RATING
router.post("/add", async (req, res) => {
  try {
    const { userId, productId, rating, review } = req.body;
 
    if (!userId || !productId || !rating || !review) {
      return res.status(400).json({ message: "Missing fields" });
    }
 
    const sql = `
      INSERT INTO ratings (user_id, product_id, rating, review)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
 
    const result = await pool.query(sql, [
      userId,
      productId,
      rating,
      review,
    ]);
 
    res.json({ message: "Rating submitted successfully", data: result.rows[0] });
  } catch (error) {
    console.error("Rating Insert Error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});
 
// GET RATING BY PRODUCT
router.get("/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
 
    const sql = "SELECT * FROM ratings WHERE product_id = $1";
    const result = await pool.query(sql, [productId]);
 
    res.json(result.rows);
  } catch (error) {
    console.error("Rating Fetch Error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});
 
export default router;