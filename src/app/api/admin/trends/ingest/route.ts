import { NextResponse } from "next/server";
import { trendIngestSchema } from "@/domain/lab";
import { readJsonCapped } from "@/server/body";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db";
import { ingestTrend } from "@/server/admin/trends";
import { apiError } from "@/server/http";
import { checkBearer } from "@/server/security/bearer";

export const dynamic = "force-dynamic";

/**
 * Machine endpoint for the external trend scanner. Bearer TREND_INGEST_TOKEN.
 * Accepts observed facts only; candidates always start in CANDIDATE for human review.
 */
export async function POST(req: Request) {
  if (!checkBearer(req, getConfig().TREND_INGEST_TOKEN)) return new NextResponse(null, { status: 404 });
  let body;
  try {
    body = trendIngestSchema.parse(await readJsonCapped(req, 131_072));
  } catch {
    return apiError(400, "INVALID_INPUT", "Payload does not match the trend ingest schema.");
  }
  const r = await ingestTrend(await getDb(), body);
  return NextResponse.json(r, { status: r.created ? 201 : 200 });
}
