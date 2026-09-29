import "./_env";
import { getDb } from "@/server/db";
import { runRetention } from "@/server/retention";

const db = await getDb();
const r = await runRetention(db);
console.log(`retention: deleted ${r.sources} source photo(s), ${r.results} result video(s)`);
await db.close();
