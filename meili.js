// hotbray-backend/meili.js
import { MeiliSearch } from "meilisearch";

const MEILI_HOST = process.env.MEILI_HOST || "http://localhost:7700";
const MEILI_KEY  = process.env.MEILI_MASTER_KEY || "HOTBRAY_SEARCH_KEY";

const meili = new MeiliSearch({
  host: MEILI_HOST,
  apiKey: MEILI_KEY,
});

export default meili;
