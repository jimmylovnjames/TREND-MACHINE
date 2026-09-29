"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  canMoveConcept,
  canMoveTrend,
  CONCEPT_STATUSES,
  countertrendSchema,
  mechanicAssessmentSchema,
  trendIngestSchema,
  trendReviewSchema,
  TREND_STATUSES,
} from "@/domain/lab";
import { getDb } from "@/server/db";
import { ingestTrend } from "@/server/admin/trends";
import { hitRateLimit } from "@/server/ratelimit";
import { ipHash } from "@/server/security/request";
import {
  approveReferenceAsset,
  ReferenceValidationError,
  setReferenceStatus,
  SUITABILITY_CHECKS,
} from "@/server/reference";
import {
  checkAdminToken,
  clearAdminSession,
  createAdminSession,
  requireAdmin,
} from "@/server/security/admin";

/*
 * Admin mutations. Next.js server actions enforce same-origin (Origin vs Host) which,
 * together with the SameSite=Strict session cookie, protects against CSRF. Every action
 * re-checks the admin session and writes an audit log entry.
 */

export type ActionState = { ok: boolean; message: string } | null;

async function audit(action: string, target: string, detail: unknown) {
  const db = await getDb();
  await db.query("insert into admin_audit_log (actor, action, target, detail) values ('admin', $1, $2, $3)", [
    action,
    target,
    JSON.stringify(detail ?? {}),
  ]);
}

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const db = await getDb();
  // Per-IP when the IP is known (behind a trusted proxy), plus a global ceiling.
  const ip = ipHash(await headers());
  const tooMany =
    (ip && !(await hitRateLimit(db, `admin-login:${ip}`, 900, 10))) ||
    !(await hitRateLimit(db, "admin-login", 900, 60));
  if (tooMany) return { ok: false, message: "Too many attempts. Wait 15 minutes." };
  const token = String(form.get("token") ?? "");
  if (!checkAdminToken(token)) return { ok: false, message: "Invalid token." };
  await createAdminSession();
  await audit("admin.login", "session", {});
  redirect("/admin");
}

export async function logoutAction() {
  await clearAdminSession();
  redirect("/admin");
}

export async function approveReferenceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  const reviewer = String(form.get("reviewer") ?? "").trim();
  const checks = Object.fromEntries(SUITABILITY_CHECKS.map((c) => [c, form.get(c) === "on"]));
  try {
    const r = await approveReferenceAsset(await getDb(), id, reviewer, checks);
    revalidatePath("/admin", "layout");
    return {
      ok: true,
      message: `Approved${r.templateVersion ? ` — template now v${r.templateVersion}` : ""}.`,
    };
  } catch (e) {
    if (e instanceof ReferenceValidationError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function rejectReferenceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  const status = z.enum(["REJECTED", "RETIRED"]).parse(form.get("status"));
  const reason = z.string().min(3).max(500).safeParse(form.get("reason"));
  if (!reason.success) return { ok: false, message: "A reason is required." };
  await setReferenceStatus(await getDb(), id, status, "admin", reason.data);
  revalidatePath("/admin", "layout");
  return { ok: true, message: `Marked ${status.toLowerCase()}.` };
}

export async function conceptStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z
    .string()
    .regex(/^con_[a-z0-9_]+$/)
    .parse(form.get("id"));
  const to = z.enum(CONCEPT_STATUSES).parse(form.get("status"));
  const db = await getDb();
  const [c] = await db.query<{ status: (typeof CONCEPT_STATUSES)[number] }>(
    "select status from dance_concepts where id = $1",
    [id],
  );
  if (!c) return { ok: false, message: "Concept not found." };
  if (!canMoveConcept(c.status, to)) return { ok: false, message: `Can't move ${c.status} → ${to}.` };
  await db.query("update dance_concepts set status = $2, updated_at = now() where id = $1", [id, to]);
  await audit("concept.status", id, { from: c.status, to });
  revalidatePath("/admin/lab");
  return { ok: true, message: `${c.status} → ${to}` };
}

export async function createTrendAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = trendIngestSchema.safeParse({
    externalRef: `manual:${crypto.randomUUID()}`,
    name: form.get("name"),
    sourcePlatform: form.get("sourcePlatform"),
    sourceUrl: form.get("sourceUrl"),
    observedAt: new Date(String(form.get("observedAt") || new Date().toISOString())).toISOString(),
    movementDescription: form.get("movementDescription") ?? "",
    signatureMovement: form.get("signatureMovement") ?? "",
    hook: form.get("hook") ?? "",
    evidence: [],
  });
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  const r = await ingestTrend(await getDb(), parsed.data);
  await audit("trend.create", r.id, { name: parsed.data.name });
  revalidatePath("/admin/trends");
  return { ok: true, message: "Trend candidate added." };
}

const optScore = z.preprocess(
  (v) => (v === "" || v === null ? null : Number(v)),
  z.number().int().min(1).max(5).nullable(),
);

export async function reviewTrendAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  const parsed = trendReviewSchema.safeParse({
    status: form.get("status") || undefined,
    loopability: optScore.parse(form.get("loopability")),
    motionTransferSuitability: optScore.parse(form.get("motionTransferSuitability")),
    singlePhotoSuitability: optScore.parse(form.get("singlePhotoSuitability")),
    reproductionDifficulty: optScore.parse(form.get("reproductionDifficulty")),
    notes: form.get("notes") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: "Invalid review values." };
  const db = await getDb();
  const [t] = await db.query<{ status: (typeof TREND_STATUSES)[number] }>(
    "select status from trend_candidates where id = $1",
    [id],
  );
  if (!t) return { ok: false, message: "Trend not found." };
  const v = parsed.data;
  if (v.status && v.status !== t.status && !canMoveTrend(t.status, v.status))
    return { ok: false, message: `Can't move ${t.status} → ${v.status}.` };
  await db.query(
    `update trend_candidates set status = coalesce($2, status), loopability = $3, motion_transfer_suitability = $4,
       single_photo_suitability = $5, reproduction_difficulty = $6, notes = coalesce($7, notes), updated_at = now() where id = $1`,
    [
      id,
      v.status ?? null,
      v.loopability ?? null,
      v.motionTransferSuitability ?? null,
      v.singlePhotoSuitability ?? null,
      v.reproductionDifficulty ?? null,
      v.notes ?? null,
    ],
  );
  await audit("trend.review", id, v);
  revalidatePath("/admin/trends");
  return { ok: true, message: "Saved." };
}

export async function addMechanicAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.string().uuid().parse(form.get("trendId"));
  const parsed = mechanicAssessmentSchema.safeParse({
    characteristic: form.get("characteristic"),
    score: form.get("score") === "" ? null : Number(form.get("score")),
    rationale: form.get("rationale"),
    assessedBy: "HUMAN",
    assessor: String(form.get("assessor") || "admin"),
  });
  if (!parsed.success) return { ok: false, message: "Characteristic and rationale are required." };
  const m = parsed.data;
  await (
    await getDb()
  ).query(
    "insert into trend_mechanics (trend_id, characteristic, score, rationale, assessed_by, assessor) values ($1,$2,$3,$4,$5,$6)",
    [id, m.characteristic, m.score, m.rationale, m.assessedBy, m.assessor],
  );
  await audit("trend.mechanic", id, m);
  revalidatePath("/admin/trends");
  return { ok: true, message: "Mechanic recorded." };
}

export async function addCountertrendAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = countertrendSchema.safeParse({
    trendId: form.get("trendId"),
    conceptId: form.get("conceptId"),
    mechanicsExploited: form.getAll("mechanicsExploited"),
    differentiation: form.get("differentiation"),
  });
  if (!parsed.success)
    return { ok: false, message: "Pick a concept, at least one mechanic, and explain how it differs." };
  const c = parsed.data;
  await (
    await getDb()
  ).query(
    `insert into countertrends (trend_id, concept_id, mechanics_exploited, differentiation) values ($1,$2,$3,$4)
     on conflict (trend_id, concept_id) do update set mechanics_exploited = excluded.mechanics_exploited, differentiation = excluded.differentiation`,
    [c.trendId, c.conceptId, c.mechanicsExploited, c.differentiation],
  );
  await audit("trend.countertrend", c.trendId, c);
  revalidatePath("/admin/trends");
  return { ok: true, message: "Countertrend linked." };
}
