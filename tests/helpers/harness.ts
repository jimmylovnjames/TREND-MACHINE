import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfigForTests } from "@/server/config";
import { createPgliteDb, setDbForTests, type Db } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { syncContent } from "@/server/db/seed";
import { resetHealthForTests } from "@/server/generation/health";
import { setProvidersForTests } from "@/server/providers/registry";
import type { GenerationProvider } from "@/server/providers/types";
import { setStorageForTests } from "@/server/storage";
import { LocalStorage } from "@/server/storage/local";

export const TEST_SECRET = "test-secret-test-secret-test-secret-1234";

export interface Harness {
  db: Db;
  storage: LocalStorage;
  storageDir: string;
  cleanup(): Promise<void>;
}

let shared: Db | undefined;

/** One migrated in-memory Postgres (PGlite) per test file, reset to seed content per test. */
async function freshDb(): Promise<Db> {
  if (!shared) {
    shared = await createPgliteDb(undefined);
    await runMigrations(shared);
  } else {
    const tables = await shared.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'",
    );
    await shared.exec(
      `truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`,
    );
  }
  await syncContent(shared, "test");
  return shared;
}

/** Fresh database state + temp private storage + injected providers. */
export async function createHarness(
  providers: GenerationProvider[],
  env: Record<string, string> = {},
): Promise<Harness> {
  for (const [k, v] of Object.entries({ APP_SECRET: TEST_SECRET, NODE_ENV: "test", ...env }))
    process.env[k] = v;
  resetConfigForTests();
  resetHealthForTests();
  const db = await freshDb();
  setDbForTests(db);
  const storageDir = mkdtempSync(path.join(tmpdir(), "tm-store-"));
  const storage = new LocalStorage(storageDir, TEST_SECRET);
  setStorageForTests(storage);
  setProvidersForTests(providers);
  return {
    db,
    storage,
    storageDir,
    async cleanup() {
      setProvidersForTests(undefined);
      setStorageForTests(undefined);
      setDbForTests(undefined);
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}
