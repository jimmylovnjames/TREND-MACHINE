import { rmSync } from "node:fs";
import { createPostgresDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { syncContent } from "@/server/db/seed";

/** Reset the e2e database + storage to a clean, migrated, seeded state. Refuses non-e2e databases. */
const url = process.env.DATABASE_URL ?? "";
if (!/e2e/.test(url)) {
  console.error("e2e-prepare: DATABASE_URL must point at an e2e database (name containing 'e2e')");
  process.exit(1);
}
rmSync(process.env.LOCAL_STORAGE_DIR ?? ".data/e2e-storage", { recursive: true, force: true });
const db = await createPostgresDb(url, false);
await db.exec("drop schema public cascade; create schema public;");
await runMigrations(db);
await syncContent(db, "e2e");
await db.close();
console.log("e2e database ready");
