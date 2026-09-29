import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { apiError, noStore, rejectCrossSite } from "@/server/http";
import { cancelJob, jobViewFor } from "@/server/generation/service";
import { readDevice } from "@/server/security/request";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const csrf = rejectCrossSite(req);
  if (csrf) return csrf;
  const { id } = await ctx.params;
  const device = await readDevice();
  if (!device || !/^[0-9a-f-]{36}$/i.test(id)) return apiError(404, "NOT_FOUND", "Video not found.", noStore);
  const job = await cancelJob(id, device.ownerHash);
  if (!job) return apiError(404, "NOT_FOUND", "Video not found.", noStore);
  return NextResponse.json({ job: await jobViewFor(await getDb(), job) }, { headers: noStore });
}
