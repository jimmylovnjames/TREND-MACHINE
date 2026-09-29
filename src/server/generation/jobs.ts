import "server-only";
import {
  allowedSources,
  type GenerationErrorCode,
  type JobStatus,
  type ReadinessBlocker,
} from "@/domain/generation";
import type { Queryable } from "../db";

export interface JobRow {
  id: string;
  owner_hash: string;
  ip_hash: string | null;
  idempotency_key: string;
  template_id: string;
  template_version_id: string;
  template_version: number;
  upload_id: string | null;
  regenerate_of: string | null;
  status: JobStatus;
  error_code: GenerationErrorCode | null;
  error_detail: string | null;
  provider_id: string | null;
  provider_model: string | null;
  provider_job_id: string | null;
  provider_status: string | null;
  progress: number | null;
  submit_attempts: number;
  poll_count: number;
  finalize_attempts: number;
  dispatch_lease_until: Date | null;
  poll_lease_until: Date | null;
  next_poll_at: Date | null;
  provider_output_url: string | null;
  submitted_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  deadline_at: Date | null;
  result_storage_key: string | null;
  result_content_type: string | null;
  result_bytes: string | number | null;
  result_expires_at: Date | null;
  result_deleted_at: Date | null;
  cost_usd: string | null;
  cost_source: string | null;
  routing: {
    blockers?: ReadinessBlocker[];
    candidates?: unknown[];
    rejected?: unknown[];
    attempts?: unknown[];
  };
  provenance: Record<string, unknown>;
  device_class: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function getJob(q: Queryable, id: string): Promise<JobRow | null> {
  const rows = await q.query<JobRow>("select * from generation_jobs where id = $1", [id]);
  return rows[0] ?? null;
}

export async function getOwnedJob(q: Queryable, id: string, ownerHash: string): Promise<JobRow | null> {
  const rows = await q.query<JobRow>("select * from generation_jobs where id = $1 and owner_hash = $2", [
    id,
    ownerHash,
  ]);
  return rows[0] ?? null;
}

type Patch = Partial<Record<keyof JobRow, unknown>>;

function patchSql(patch: Patch, startIndex: number): { sql: string; values: unknown[] } {
  const cols = Object.keys(patch) as (keyof JobRow)[];
  for (const c of cols) if (!/^[a-z_]+$/.test(c)) throw new Error("bad column");
  const values = cols.map((c) => {
    const v = patch[c];
    return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  const sql = cols.map((c, i) => `${c} = $${startIndex + i}`).join(", ");
  return { sql, values };
}

/**
 * Atomically move a job to `to` if (and only if) its current status allows it.
 * Returns the updated row, or null if another worker already moved it.
 */
export async function transition(
  q: Queryable,
  id: string,
  to: JobStatus,
  patch: Patch = {},
  opts: { from?: JobStatus[] } = {},
): Promise<JobRow | null> {
  const from = (opts.from ?? allowedSources(to)).filter((s) => allowedSources(to).includes(s));
  const { sql, values } = patchSql(patch, 4);
  const rows = await q.query<JobRow & { prev_status: JobStatus }>(
    `with prev as (select id, status from generation_jobs where id = $1 for update)
     update generation_jobs j set status = $2, updated_at = now()${sql ? `, ${sql}` : ""}
     from prev where j.id = prev.id and prev.status = any($3::text[])
     returning j.*, prev.status as prev_status`,
    [id, to, from, ...values],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.prev_status !== to) {
    await q.query(
      "insert into generation_job_transitions (job_id, from_status, to_status, code) values ($1, $2, $3, $4)",
      [id, row.prev_status, to, (patch.error_code as string | undefined) ?? null],
    );
  }
  return row;
}

/** Update non-status fields, guarded by the job still being in one of `statuses`. */
export async function patchJob(
  q: Queryable,
  id: string,
  patch: Patch,
  statuses: JobStatus[],
): Promise<JobRow | null> {
  const { sql, values } = patchSql(patch, 3);
  const rows = await q.query<JobRow>(
    `update generation_jobs set updated_at = now(), ${sql} where id = $1 and status = any($2::text[]) returning *`,
    [id, statuses, ...values],
  );
  return rows[0] ?? null;
}
