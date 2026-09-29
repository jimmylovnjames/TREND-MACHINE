import "./_env";
import { getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";

const db = await getDb();
const r = await runMigrations(db);
console.log(
  `migrations applied: ${r.applied.length ? r.applied.join(", ") : "none"} (already applied: ${r.skipped.length})`,
);
await db.close();
