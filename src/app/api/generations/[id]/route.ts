import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { apiError, logError, noStore, rejectCrossSite } from "@/server/http";
import { jobViewFor, refreshJob } from "@/server/generation/service";
import { getOwnedJob } from "@/server/generation/jobs";
import { deleteJobMedia } from "@/server/retention";
import { readDevice } from "@/server/security/request";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const device = await readDevice();
  // Unknown, malformed and not-yours all look identical (no job enumeration).
  if (!device || !UUID.test(id)) return apiError(404, "NOT_FOUND", "Video not found.", noStore);
  const db = await getDb();
  let job = await getOwnedJob(db, id, device.ownerHash);
  if (!job) return apiError(404, "NOT_FOUND", "Video not found.", noStore);
  try {
    job = (await refreshJob(job.id, { db })) ?? job;
  } catch (e) {
    logError("refresh", e, { jobId: id });
  }
  return NextResponse.json({ job: await jobViewFor(db, job) }, { headers: noStore });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrf = rejectCrossSite(req);
  if (csrf) return csrf;
  const { id } = await ctx.params;
  const device = await readDevice();
  if (!device || !UUID.test(id)) return apiError(404, "NOT_FOUND", "Video not found.", noStore);
  const ok = await deleteJobMedia(await getDb(), id, device.ownerHash);
  if (!ok) return apiError(404, "NOT_FOUND", "Video not found.", noStore);
  return NextResponse.json({ deleted: true }, { headers: noStore });
}
