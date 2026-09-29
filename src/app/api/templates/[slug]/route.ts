import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { apiError } from "@/server/http";
import { evaluateReadiness } from "@/server/generation/service";
import { getTemplateBySlug, PUBLIC_STATUSES, toPublicTemplate } from "@/server/repo/templates";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return apiError(404, "NOT_FOUND", "Dance not found.");
  const db = await getDb();
  const rec = await getTemplateBySlug(db, slug);
  if (!rec || !PUBLIC_STATUSES.includes(rec.status)) return apiError(404, "NOT_FOUND", "Dance not found.");
  const readiness = await evaluateReadiness(db, rec);
  return NextResponse.json(
    {
      template: toPublicTemplate(rec),
      availability: { ready: readiness.ready, blockers: readiness.blockers },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
