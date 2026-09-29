import { NextResponse } from "next/server";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db";
import { advanceActiveJobs } from "@/server/generation/service";
import { runRetention } from "@/server/retention";
import { checkBearer } from "@/server/security/bearer";

export const dynamic = "force-dynamic";

/**
 * Background tick: advance active jobs nobody is watching and enforce retention.
 * Call every minute from a scheduler with `Authorization: Bearer $CRON_SECRET`.
 */
async function tick(req: Request) {
  if (!checkBearer(req, getConfig().CRON_SECRET)) return new NextResponse(null, { status: 404 });
  const db = await getDb();
  const jobs = await advanceActiveJobs(25, db);
  const retention = await runRetention(db);
  return NextResponse.json({ jobs, retention });
}

export const GET = tick;
export const POST = tick;
