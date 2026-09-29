import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { listTemplates, PUBLIC_STATUSES, toPublicTemplate } from "@/server/repo/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const templates = (await listTemplates(db, PUBLIC_STATUSES)).map((t) => toPublicTemplate(t));
  return NextResponse.json(
    { templates },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" } },
  );
}
