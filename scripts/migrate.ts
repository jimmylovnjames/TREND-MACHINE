import "./_env";
import { getConfig } from "@/server/config";
import { createPgliteDb, createPostgresDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";

// Open the database directly (getDb() would auto-migrate in development).
const cfg = getConfig();
const db = cfg.DATABASE_URL
  ? await createPostgresDb(cfg.DATABASE_URL, cfg.DATABASE_SSL)
  : await createPgliteDb(cfg.PGLITE_DATA_DIR);
const r = await runMigrations(db);
console.log(
  `migrations applied: ${r.applied.length ? r.applied.join(", ") : "none"} (already applied: ${r.skipped.length})`,
);
await db.close();
