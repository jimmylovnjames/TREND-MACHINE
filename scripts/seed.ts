import "./_env";
import { getDb } from "@/server/db";
import { syncContent } from "@/server/db/seed";

/** Sync content/templates and content/concepts into the database (versioned, idempotent). */
const db = await getDb();
const results = await syncContent(db, process.env.USER ? `cli:${process.env.USER}` : "cli");
for (const r of results) console.log(`${r.templateId}: v${r.version}${r.created ? " (new version)" : ""}`);
await db.close();
