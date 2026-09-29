import "server-only";
import type { PublicTemplate, ReferenceMotionStatus, TemplateSpec } from "@/domain/template";
import type { Queryable } from "../db";

export interface ReferenceAssetRow {
  id: string;
  template_id: string | null;
  storage_key: string;
  content_type: string;
  bytes: string | number;
  sha256: string;
  duration_seconds: string | null;
  width: number | null;
  height: number | null;
  fps: string | null;
  aspect_ratio: string | null;
  creator: string;
  owner: string;
  creation_method: string;
  license: string;
  permission_evidence: string;
  captured_on: string | Date | null;
  status: "UPLOADED" | "READY" | "REJECTED" | "RETIRED";
  suitability: Record<string, unknown>;
  notes: string;
  has_audio: boolean | null;
  created_at: string | Date;
  reviewed_at: string | Date | null;
  reviewed_by: string | null;
}

export interface TemplateRecord {
  id: string;
  slug: string;
  status: TemplateSpec["status"];
  versionId: string;
  version: number;
  versionCreatedAt: Date;
  createdAt: Date;
  spec: TemplateSpec;
  reference: ReferenceAssetRow | null;
}

interface Row {
  id: string;
  slug: string;
  status: TemplateSpec["status"];
  created_at: Date;
  version_id: string;
  version: number;
  version_created_at: Date;
  spec: TemplateSpec;
  ref: ReferenceAssetRow | null;
}

const SELECT = `
  select t.id, t.slug, t.status, t.created_at, v.id as version_id, v.version, v.created_at as version_created_at,
         v.spec, case when r.id is null then null else to_jsonb(r) end as ref
  from templates t
  join template_versions v on v.template_id = t.id and v.version = t.current_version
  left join reference_motion_assets r on r.id = v.reference_motion_asset_id`;

function toRecord(r: Row): TemplateRecord {
  return {
    id: r.id,
    slug: r.slug,
    status: r.status,
    versionId: r.version_id,
    version: r.version,
    versionCreatedAt: new Date(r.version_created_at),
    createdAt: new Date(r.created_at),
    spec: r.spec,
    reference: r.ref,
  };
}

export async function listTemplates(
  q: Queryable,
  statuses: TemplateSpec["status"][],
): Promise<TemplateRecord[]> {
  const rows = await q.query<Row>(`${SELECT} where t.status = any($1::text[]) order by t.sort_order, t.id`, [
    statuses,
  ]);
  return rows.map(toRecord);
}

export async function getTemplateBySlug(q: Queryable, slug: string): Promise<TemplateRecord | null> {
  const rows = await q.query<Row>(`${SELECT} where t.slug = $1`, [slug]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function getTemplateVersion(q: Queryable, versionId: string): Promise<TemplateRecord | null> {
  const rows = await q.query<Row>(
    `select t.id, t.slug, t.status, t.created_at, v.id as version_id, v.version, v.created_at as version_created_at,
            v.spec, case when r.id is null then null else to_jsonb(r) end as ref
     from template_versions v join templates t on t.id = v.template_id
     left join reference_motion_assets r on r.id = v.reference_motion_asset_id
     where v.id = $1`,
    [versionId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export function referenceStatus(rec: TemplateRecord): ReferenceMotionStatus {
  return rec.reference ? rec.reference.status : "REFERENCE_MOTION_PENDING";
}

export const PUBLIC_STATUSES: TemplateSpec["status"][] = ["PREVIEW", "LIVE"];
const NEW_WINDOW_DAYS = 30;

export function toPublicTemplate(rec: TemplateRecord, now = new Date()): PublicTemplate {
  const s = rec.spec;
  return {
    id: s.id,
    slug: s.slug,
    version: rec.version,
    name: s.name,
    status: s.status,
    category: s.category,
    originType: s.origin.type,
    tagline: s.tagline,
    hook: s.hook,
    description: s.description,
    durationSeconds: s.durationSeconds,
    energy: s.energy,
    difficulty: s.difficulty,
    tags: s.tags,
    featured: s.featured,
    artwork: s.artwork,
    hasPreviewVideo: !!s.media.previewVideoKey,
    movement: {
      firstSecond: s.movement.firstSecond,
      signature: s.movement.signature,
      phases: s.movement.sequence.map((p) => ({ at: p.at, name: p.name })),
      bodyFocus: s.movement.bodyFocus,
    },
    referenceMotionStatus: referenceStatus(rec),
    // "New" is a factual statement about when the template was added — nothing more.
    isNew: now.getTime() - rec.createdAt.getTime() < NEW_WINDOW_DAYS * 86400_000,
    createdAt: rec.createdAt.toISOString(),
  };
}
