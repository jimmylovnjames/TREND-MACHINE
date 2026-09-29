import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import pg from "pg";
import { makeMp4 } from "../helpers/mp4";
import { figurePng } from "../helpers/png";
import { E2E_DATABASE_URL, E2E_SECRET, E2E_STORAGE } from "../../playwright.config";

export function fixturePhoto(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "figure.png");
  writeFileSync(p, figurePng(720, 1280));
  return p;
}

export async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Owner hash for the browser's device cookie (mirrors src/server/security/request.ts). */
export async function ownerHashFor(ctx: BrowserContext): Promise<string> {
  const token = (await ctx.cookies()).find((c) => c.name === "tm_did")?.value;
  if (!token) throw new Error("no device cookie yet");
  return createHmac("sha256", E2E_SECRET).update(`owner\u0000${token}`).digest("hex");
}

/**
 * Seed a COMPLETED job owned by this browser. Used only to test the result UI, because the
 * sandbox has no provider credentials; the real pipeline is covered by integration tests.
 */
export async function seedCompletedJob(ctx: BrowserContext, templateId = "tpl_rubber_legs"): Promise<string> {
  const owner = await ownerHashFor(ctx);
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = `results/${hex}.mp4`;
  const file = path.join(E2E_STORAGE, key);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, makeMp4({ seconds: 6 }));
  return withDb(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into generation_jobs (owner_hash, idempotency_key, template_id, template_version_id, template_version, status,
         provider_id, provider_model, provider_job_id, submitted_at, completed_at, result_storage_key, result_content_type,
         result_bytes, result_expires_at)
       select $1, $2, t.id, v.id, v.version, 'COMPLETED', 'seed', 'seed', 'seed', now() - interval '2 minutes', now(), $3,
              'video/mp4', 100, now() + interval '30 days'
       from templates t join template_versions v on v.template_id = t.id and v.version = t.current_version where t.id = $4
       returning id`,
      [owner, `seed-${hex}`, key, templateId],
    );
    return rows[0]!.id;
  });
}
