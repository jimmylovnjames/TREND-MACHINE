import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TemplateSpec } from "@/domain/template";
import type { Db } from "./db";
import { upsertTemplateVersion } from "./db/seed";
import { sha256Hex } from "./security/crypto";
import { getStorage, newKey } from "./storage";
import { inspectMp4, type Mp4Info } from "./uploads/mp4";

/**
 * Reference-motion library. Every asset carries provenance and rights metadata, and must
 * pass an explicit suitability review before any template can use it.
 */

export const SUITABILITY_CHECKS = [
  "single_performer",
  "full_body_visible",
  "continuous_single_take",
  "limited_occlusion",
  "stable_locked_off_camera",
  "moderate_movement_speed",
  "no_unlicensed_audio",
] as const;
export type SuitabilityCheck = (typeof SUITABILITY_CHECKS)[number];

export const referenceRegistrationSchema = z.object({
  templateId: z
    .string()
    .regex(/^tpl_[a-z0-9_]+$/)
    .nullable(),
  creator: z.string().min(2).max(200),
  owner: z.string().min(2).max(200),
  creationMethod: z.enum(["STUDIO_CAPTURE", "IN_HOUSE_CAPTURE", "COMMISSIONED", "LICENSED_STOCK"]),
  license: z.string().min(3).max(500),
  permissionEvidence: z.string().min(3).max(1000),
  capturedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  notes: z.string().max(4000).default(""),
});
export type ReferenceRegistration = z.infer<typeof referenceRegistrationSchema>;

export const REFERENCE_LIMITS = { minSeconds: 3, maxSeconds: 30, maxBytes: 100 * 1024 * 1024 } as const;

export class ReferenceValidationError extends Error {}

export interface RegisteredReference {
  id: string;
  info: Mp4Info;
  warnings: string[];
}

export function assessVideo(info: Mp4Info, bytes: number): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (bytes > REFERENCE_LIMITS.maxBytes)
    errors.push(`file is larger than ${REFERENCE_LIMITS.maxBytes / 1024 / 1024} MB`);
  if (info.durationSeconds < REFERENCE_LIMITS.minSeconds)
    errors.push(`duration ${info.durationSeconds}s is below ${REFERENCE_LIMITS.minSeconds}s`);
  if (info.durationSeconds > REFERENCE_LIMITS.maxSeconds)
    errors.push(`duration ${info.durationSeconds}s exceeds ${REFERENCE_LIMITS.maxSeconds}s`);
  if (info.height <= info.width)
    warnings.push("video is not portrait; 9:16 portrait is strongly recommended");
  const aspect = info.width / info.height;
  if (Math.abs(aspect - 9 / 16) > 0.03) warnings.push(`aspect ${info.width}x${info.height} is not 9:16`);
  if (Math.min(info.width, info.height) < 720) warnings.push("resolution below 720p");
  if (info.fps !== null && (info.fps < 24 || info.fps > 60)) warnings.push(`unusual frame rate ${info.fps}`);
  if (info.hasAudio)
    warnings.push("has an audio track: providers that cannot drop reference audio will not be used");
  return { errors, warnings };
}

export async function registerReferenceAsset(
  db: Db,
  data: Uint8Array,
  meta: ReferenceRegistration,
): Promise<RegisteredReference> {
  const m = referenceRegistrationSchema.parse(meta);
  let info: Mp4Info;
  try {
    info = inspectMp4(data);
  } catch (e) {
    throw new ReferenceValidationError(`not a readable MP4: ${(e as Error).message}`);
  }
  const { errors, warnings } = assessVideo(info, data.byteLength);
  if (errors.length) throw new ReferenceValidationError(errors.join("; "));
  if (m.templateId) {
    const [t] = await db.query("select 1 from templates where id = $1", [m.templateId]);
    if (!t) throw new ReferenceValidationError(`unknown template ${m.templateId}`);
  }
  const id = randomUUID();
  const key = newKey("reference", id.replace(/-/g, ""), "video/mp4");
  await getStorage().put(key, data, "video/mp4");
  await db.query(
    `insert into reference_motion_assets (id, template_id, storage_key, content_type, bytes, sha256, duration_seconds, width, height,
       fps, aspect_ratio, creator, owner, creation_method, license, permission_evidence, captured_on, status, notes, has_audio, suitability)
     values ($1,$2,$3,'video/mp4',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'UPLOADED',$17,$18,$19)`,
    [
      id,
      m.templateId,
      key,
      data.byteLength,
      sha256Hex(data),
      info.durationSeconds,
      info.width,
      info.height,
      info.fps,
      `${info.width}:${info.height}`,
      m.creator,
      m.owner,
      m.creationMethod,
      m.license,
      m.permissionEvidence,
      m.capturedOn,
      m.notes,
      info.hasAudio,
      JSON.stringify({ warnings }),
    ],
  );
  return { id, info, warnings };
}

/**
 * Approve an asset: requires every suitability check to be affirmed by a named reviewer.
 * If the asset belongs to a template, a new template version pinning it is created.
 */
export async function approveReferenceAsset(
  db: Db,
  assetId: string,
  reviewer: string,
  checks: Partial<Record<SuitabilityCheck, boolean>>,
): Promise<{ templateVersion: number | null }> {
  const missing = SUITABILITY_CHECKS.filter((c) => checks[c] !== true);
  if (missing.length) throw new ReferenceValidationError(`suitability not confirmed: ${missing.join(", ")}`);
  if (!reviewer.trim()) throw new ReferenceValidationError("reviewer required");
  return db.tx(async (q) => {
    const [asset] = await q.query<{
      id: string;
      template_id: string | null;
      status: string;
      suitability: Record<string, unknown>;
    }>("select id, template_id, status, suitability from reference_motion_assets where id = $1 for update", [
      assetId,
    ]);
    if (!asset) throw new ReferenceValidationError("asset not found");
    if (asset.status !== "UPLOADED" && asset.status !== "READY")
      throw new ReferenceValidationError(`cannot approve asset in status ${asset.status}`);
    await q.query(
      `update reference_motion_assets set status = 'READY', reviewed_at = now(), reviewed_by = $2, suitability = $3 where id = $1`,
      [
        assetId,
        reviewer,
        JSON.stringify({
          ...asset.suitability,
          checks,
          reviewedBy: reviewer,
          reviewedAt: new Date().toISOString(),
        }),
      ],
    );
    let templateVersion: number | null = null;
    if (asset.template_id) {
      const [latest] = await q.query<{ spec: TemplateSpec }>(
        "select spec from template_versions where template_id = $1 order by version desc limit 1",
        [asset.template_id],
      );
      if (latest) {
        const r = await upsertTemplateVersion(q, latest.spec, {
          actor: reviewer,
          referenceAssetId: assetId,
          changeNote: `reference motion ${assetId} approved`,
        });
        templateVersion = r.version;
        await q.query(
          `update dance_concepts set status = 'REFERENCE_READY', updated_at = now()
           where template_id = $1 and status in ('DESIGNED','REFERENCE_PENDING')`,
          [asset.template_id],
        );
      }
    }
    await q.query(
      "insert into admin_audit_log (actor, action, target, detail) values ($1, 'reference.approve', $2, $3)",
      [reviewer, assetId, JSON.stringify({ checks, templateVersion })],
    );
    return { templateVersion };
  });
}

export async function setReferenceStatus(
  db: Db,
  assetId: string,
  status: "REJECTED" | "RETIRED",
  actor: string,
  reason: string,
): Promise<void> {
  await db.tx(async (q) => {
    const rows = await q.query<{ template_id: string | null }>(
      "update reference_motion_assets set status = $2, reviewed_at = now(), reviewed_by = $3, notes = notes || $4 where id = $1 returning template_id",
      [assetId, status, actor, `\n[${status}] ${reason}`],
    );
    if (!rows[0]) throw new ReferenceValidationError("asset not found");
    // Templates pinned to this asset stop being generatable automatically (readiness checks status).
    await q.query("insert into admin_audit_log (actor, action, target, detail) values ($1, $2, $3, $4)", [
      actor,
      `reference.${status.toLowerCase()}`,
      assetId,
      JSON.stringify({ reason }),
    ]);
  });
}
