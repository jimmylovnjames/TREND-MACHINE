import { NextResponse } from "next/server";
import { clientEventBatchSchema } from "@/domain/analytics";
import { track } from "@/server/analytics/track";
import { getDb } from "@/server/db";
import { apiError, rejectCrossSite } from "@/server/http";
import { readJsonCapped } from "@/server/body";
import { hitRateLimit } from "@/server/ratelimit";
import { deviceClass, ensureDevice } from "@/server/security/request";

export const dynamic = "force-dynamic";

/** Client analytics ingestion. Closed schema, whitelisted props, rate limited. */
export async function POST(req: Request) {
  const csrf = rejectCrossSite(req);
  if (csrf) return csrf;
  let batch;
  try {
    batch = clientEventBatchSchema.parse(await readJsonCapped(req, 32_768));
  } catch {
    return apiError(400, "INVALID_INPUT", "Invalid events.");
  }
  const device = await ensureDevice();
  const db = await getDb();
  if (!(await hitRateLimit(db, `events:${device.anonId}`, 60, 120)))
    return new NextResponse(null, { status: 429 });
  const dc = deviceClass(req.headers.get("user-agent"));
  const now = Date.now();
  for (const e of batch.events) {
    // Clamp client clocks: accept at most 1 day in the past, never in the future.
    const at = new Date(Math.min(now, Math.max(e.at, now - 86400_000)));
    await track(db, {
      name: e.name,
      source: "client",
      occurredAt: at,
      anonId: device.anonId,
      sessionId: e.sessionId,
      templateId: e.templateId ?? null,
      templateVersion: e.templateVersion ?? null,
      jobId: e.jobId ?? null,
      deviceClass: dc,
      props: e.props ?? {},
    });
  }
  return new NextResponse(null, { status: 204 });
}
