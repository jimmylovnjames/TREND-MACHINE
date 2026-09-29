import "server-only";
import { getConfig } from "../config";
import { runMigrations } from "./migrate";

/**
 * Minimal database abstraction: parameterized SQL only (no string interpolation of
 * values anywhere in the codebase). Backed by node-postgres in production or by
 * embedded PGlite for zero-config development and tests.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Execute a multi-statement script without parameters (migrations only). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: "postgres" | "pglite";
}

type GlobalWithDb = typeof globalThis & { __tmDb?: Promise<Db> };
const g = globalThis as GlobalWithDb;

export function getDb(): Promise<Db> {
  if (!g.__tmDb) {
    g.__tmDb = createDb().catch((err) => {
      g.__tmDb = undefined;
      throw err;
    });
  }
  return g.__tmDb;
}

/** For tests: install a specific database instance. */
export function setDbForTests(db: Db | undefined): void {
  g.__tmDb = db ? Promise.resolve(db) : undefined;
}

async function createDb(): Promise<Db> {
  const cfg = getConfig();
  if (cfg.DATABASE_URL) {
    const db = await createPostgresDb(cfg.DATABASE_URL, cfg.DATABASE_SSL);
    // Production deployments run `npm run db:migrate` explicitly; dev auto-migrates.
    if (!cfg.isProduction) await runMigrations(db);
    return db;
  }
  const db = await createPgliteDb(cfg.PGLITE_DATA_DIR);
  await runMigrations(db);
  const { seedIfEmpty } = await import("./seed");
  await seedIfEmpty(db);
  return db;
}

export async function createPostgresDb(url: string, ssl: boolean): Promise<Db> {
  const { Pool } = (await import("pg")).default;
  const pool = new Pool({
    connectionString: url,
    max: 10,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
  });
  pool.on("error", (err) => console.error("[db] idle client error", err.message));
  return {
    kind: "postgres",
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pool.query(text, params as unknown[]);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn({
          async query<R>(text: string, params: unknown[] = []) {
            return (await client.query(text, params as unknown[])).rows as R[];
          },
          async exec(sql: string) {
            await client.query(sql);
          },
        });
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function createPgliteDb(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dataDir, { recursive: true });
  }
  const pg = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  // PGlite is a single connection; serialize transactions so they never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const q = async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows;
  return {
    kind: "pglite",
    query: async <T>(text: string, params: unknown[] = []) => {
      await chain.catch(() => undefined);
      return q<T>(text, params);
    },
    exec: async (sql: string) => {
      await chain.catch(() => undefined);
      await pg.exec(sql);
    },
    // NOTE: inside `fn`, only use the provided Queryable — calling the outer db would deadlock.
    tx<T>(fn: (qq: Queryable) => Promise<T>) {
      const run = chain
        .catch(() => undefined)
        .then(() =>
          pg.transaction(async (t) =>
            fn({
              query: async <R>(text: string, params: unknown[] = []) => (await t.query<R>(text, params)).rows,
              exec: async (sql: string) => {
                await t.exec(sql);
              },
            }),
          ),
        );
      chain = run;
      return run as Promise<T>;
    },
    close: () => pg.close(),
  };
}
