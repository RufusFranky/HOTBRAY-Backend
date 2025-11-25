// hotbray-backend/indexMeili.js
import meili from "./meili.js";
import pool from "./db.js";

async function createAndPopulate() {
  try {
    const index = meili.index("products");

    // 1) Create index (if not exists) with primaryKey 'id'
    await index.updateSettings({
      searchableAttributes: ["name", "part_number", "category", "description", "brand"],
      displayedAttributes: ["id", "name", "part_number", "price", "image", "description", "category"],
      filterableAttributes: ["category", "brand"],
      rankingRules: [
        "typo",
        "words",
        "proximity",
        "attribute",
        "exactness",
        "desc(price)"
      ],
    });

    // 2) Synonyms - map common variants
    await index.updateSynonyms({
      tire: ["tyre"],
      tyre: ["tire"],
      wipres: ["wiper", "wipers"],
      wiper: ["wipres", "wipers"],
      breaks: ["brakes", "brake"],
      brakes: ["breaks", "brake"],
      battery: ["battrie", "baterie"]
      // add more pairs as needed
    });

    // 3) Fetch products from Postgres
    const res = await pool.query(
      `SELECT id, name, price, image, description, category, part_number
       FROM products
       ORDER BY id`
    );

    const rows = res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      part_number: r.part_number,
      price: r.price !== null ? parseFloat(r.price) : null,
      image: r.image || null,
      description: r.description || "",
      category: r.category || null,
      // you can add other fields (brand, tags) if available
    }));

    if (rows.length === 0) {
      console.log("No products found to index.");
    } else {
      // 4) Add documents (Meilisearch will upsert by id)
      const addRes = await index.addDocuments(rows);
      console.log("Indexing started:", addRes);
    }

    console.log("Indexing script finished.");
    process.exit(0);
  } catch (err) {
    console.error("Indexing error:", err);
    process.exit(1);
  }
}

createAndPopulate();
