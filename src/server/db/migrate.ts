import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./index";

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply repository-controlled SQL migrations in lexical order, each in its own
 * transaction. Applied migrations are immutable: a changed checksum aborts.
 */
export async function runMigrations(db: Db, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  await db.exec(`create table if not exists schema_migrations (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const done = await db.tx(async (q) => {
      if (db.kind === "postgres") await q.query("select pg_advisory_xact_lock(7271999)");
      const rows = await q.query<{ checksum: string }>(
        "select checksum from schema_migrations where version = $1",
        [file],
      );
      if (rows[0]) {
        if (rows[0].checksum !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied. Add a new migration instead.`);
        }
        return false;
      }
      await q.exec(sql);
      await q.query("insert into schema_migrations (version, checksum) values ($1, $2)", [file, checksum]);
      return true;
    });
    (done ? result.applied : result.skipped).push(file);
  }
  return result;
}
