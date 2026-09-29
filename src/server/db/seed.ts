import { createHash } from "node:crypto";
import type { DanceConcept } from "@/domain/lab";
import type { TemplateSpec } from "@/domain/template";
import { loadConceptSpecs, loadTemplateSpecs } from "../content";
import type { Db, Queryable } from "./index";

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function specHash(spec: TemplateSpec, referenceAssetId: string | null): string {
  return createHash("sha256")
    .update(stableStringify(spec))
    .update("|ref:")
    .update(referenceAssetId ?? "none")
    .digest("hex");
}

export interface VersionResult {
  templateId: string;
  version: number;
  created: boolean;
}

/**
 * Write a template spec. Creates a new immutable version only when the spec (or the
 * attached reference motion asset) actually changed.
 */
export async function upsertTemplateVersion(
  q: Queryable,
  spec: TemplateSpec,
  opts: { actor: string; changeNote?: string; referenceAssetId?: string | null },
): Promise<VersionResult> {
  await q.query(
    `insert into templates (id, slug, status, category, featured, sort_order)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set slug = excluded.slug, status = excluded.status,
       category = excluded.category, featured = excluded.featured, sort_order = excluded.sort_order,
       updated_at = now()`,
    [spec.id, spec.slug, spec.status, spec.category, spec.featured, spec.sortOrder],
  );
  const [latest] = await q.query<{
    version: number;
    spec_hash: string;
    reference_motion_asset_id: string | null;
  }>(
    `select version, spec_hash, reference_motion_asset_id from template_versions
     where template_id = $1 order by version desc limit 1 for update`,
    [spec.id],
  );
  const refId =
    opts.referenceAssetId !== undefined ? opts.referenceAssetId : (latest?.reference_motion_asset_id ?? null);
  const hash = specHash(spec, refId);
  if (latest && latest.spec_hash === hash)
    return { templateId: spec.id, version: latest.version, created: false };
  const version = (latest?.version ?? 0) + 1;
  await q.query(
    `insert into template_versions (template_id, version, spec, spec_hash, reference_motion_asset_id, created_by, change_note)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [spec.id, version, JSON.stringify(spec), hash, refId, opts.actor, opts.changeNote ?? ""],
  );
  await q.query("update templates set current_version = $2, updated_at = now() where id = $1", [
    spec.id,
    version,
  ]);
  return { templateId: spec.id, version, created: true };
}

export async function upsertConcept(q: Queryable, c: DanceConcept): Promise<void> {
  // Status is owned by the Dance Lab workflow after first insert; content only refreshes the spec.
  await q.query(
    `insert into dance_concepts (id, slug, name, status, spec, template_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set slug = excluded.slug, name = excluded.name, spec = excluded.spec,
       template_id = excluded.template_id, updated_at = now()`,
    [c.id, c.slug, c.name, c.status, JSON.stringify(c), c.templateId],
  );
}

export async function syncContent(db: Db, actor = "content-sync"): Promise<VersionResult[]> {
  const [templates, concepts] = await Promise.all([loadTemplateSpecs(), loadConceptSpecs()]);
  const results: VersionResult[] = [];
  for (const spec of templates) {
    results.push(await db.tx((q) => upsertTemplateVersion(q, spec, { actor, changeNote: "content sync" })));
  }
  for (const c of concepts) await db.tx((q) => upsertConcept(q, c));
  return results;
}

/** Development convenience: keep the DB in step with repository content on boot. */
export async function seedIfEmpty(db: Db): Promise<void> {
  await syncContent(db);
}
