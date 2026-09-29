import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { apiError, noStore, rejectCrossSite } from "@/server/http";
import { randomToken } from "@/server/security/crypto";
import { readDevice } from "@/server/security/request";

export const dynamic = "force-dynamic";

async function ownedCompletedJob(id: string) {
  const device = await readDevice();
  if (!device || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [job] = await db.query<{ id: string; owner_hash: string }>(
    `select id, owner_hash from generation_jobs where id = $1 and owner_hash = $2 and status = 'COMPLETED'
       and result_storage_key is not null and result_deleted_at is null`,
    [id, device.ownerHash],
  );
  return job ? { db, job } : null;
}

/** Create (or return) a public share link for the RESULT only — never the source photo. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrf = rejectCrossSite(req);
  if (csrf) return csrf;
  const { id } = await ctx.params;
  const found = await ownedCompletedJob(id);
  if (!found) return apiError(404, "NOT_FOUND", "Video not found.", noStore);
  const { db, job } = found;
  const [existing] = await db.query<{ slug: string }>(
    "select slug from shares where job_id = $1 and revoked_at is null",
    [job.id],
  );
  let slug = existing?.slug;
  if (!slug) {
    slug = randomToken(12);
    const [row] = await db.query<{ slug: string }>(
      `insert into shares (slug, job_id, owner_hash) values ($1, $2, $3)
       on conflict (job_id) where revoked_at is null do nothing returning slug`,
      [slug, job.id, job.owner_hash],
    );
    if (!row) {
      const [again] = await db.query<{ slug: string }>(
        "select slug from shares where job_id = $1 and revoked_at is null",
        [job.id],
      );
      slug = again!.slug;
    }
  }
  return NextResponse.json({ share: { slug, path: `/s/${slug}` } }, { headers: noStore });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrf = rejectCrossSite(req);
  if (csrf) return csrf;
  const { id } = await ctx.params;
  const device = await readDevice();
  if (!device || !/^[0-9a-f-]{36}$/i.test(id)) return apiError(404, "NOT_FOUND", "Video not found.", noStore);
  const db = await getDb();
  await db.query(
    "update shares set revoked_at = now() where job_id = $1 and owner_hash = $2 and revoked_at is null",
    [id, device.ownerHash],
  );
  return NextResponse.json({ revoked: true }, { headers: noStore });
}
