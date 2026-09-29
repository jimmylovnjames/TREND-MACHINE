import "server-only";
import {
  isTerminal,
  userFacingError,
  type GenerationErrorCode,
  type JobStatus,
  type ReadinessBlocker,
  type UserFacingError,
} from "@/domain/generation";
import { track } from "../analytics/track";
import { getConfig } from "../config";
import { getDb, type Db, type Queryable } from "../db";
import { getStorage, newKey } from "../storage";
import { getProvider, registeredProviders } from "../providers/registry";
import { routeGeneration, type RoutingDecision } from "../providers/router";
import { ProviderError, type ProviderJobStatus } from "../providers/types";
import { isSafeOutputUrl } from "../providers/http";
import {
  getTemplateBySlug,
  getTemplateVersion,
  PUBLIC_STATUSES,
  type TemplateRecord,
} from "../repo/templates";
import { hmacB64, safeEqual } from "../security/crypto";
import { getProviderHealth, openCircuit } from "./health";
import { getJob, getOwnedJob, patchJob, transition, type JobRow } from "./jobs";

/* ------------------------------------------------------------------------- */
/* Readiness                                                                  */
/* ------------------------------------------------------------------------- */

export const BLOCKER_MESSAGES: Record<ReadinessBlocker["code"], string> = {
  REFERENCE_MOTION_NOT_READY:
    "The reference performance for this dance hasn't been recorded and approved yet.",
  PROVIDER_NOT_CONFIGURED: "No video-generation engine is connected in this environment.",
};

export interface Readiness {
  ready: boolean;
  blockers: ReadinessBlocker[];
  routing: RoutingDecision;
}

export async function evaluateReadiness(q: Queryable, rec: TemplateRecord): Promise<Readiness> {
  const blockers: ReadinessBlocker[] = [];
  const refReady = rec.reference?.status === "READY";
  if (!refReady)
    blockers.push({
      code: "REFERENCE_MOTION_NOT_READY",
      message: BLOCKER_MESSAGES.REFERENCE_MOTION_NOT_READY,
    });
  const routing = routeGeneration(rec.spec, await registeredProviders(), {
    tier: getConfig().GENERATION_QUALITY_TIER,
    reference:
      refReady && rec.reference
        ? {
            durationSeconds:
              rec.reference.duration_seconds !== null ? Number(rec.reference.duration_seconds) : null,
            bytes: Number(rec.reference.bytes),
            hasAudio: rec.reference.has_audio,
          }
        : null,
    health: await getProviderHealth(q),
  });
  if (routing.blocker === "PROVIDER_NOT_CONFIGURED") {
    blockers.push({ code: "PROVIDER_NOT_CONFIGURED", message: BLOCKER_MESSAGES.PROVIDER_NOT_CONFIGURED });
  } else if (routing.blocker === "REFERENCE_MOTION_NOT_READY" && refReady) {
    blockers.push({
      code: "REFERENCE_MOTION_NOT_READY",
      message: "The recorded reference performance doesn't meet the connected engine's requirements.",
    });
  }
  return { ready: blockers.length === 0 && routing.candidates.length > 0, blockers, routing };
}

/* ------------------------------------------------------------------------- */
/* Public job view                                                            */
/* ------------------------------------------------------------------------- */

export interface JobView {
  id: string;
  status: JobStatus;
  progress: number | null;
  error: UserFacingError | null;
  blockers: ReadinessBlocker[];
  template: { id: string; slug: string; name: string; version: number };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  regenerateOf: string | null;
  result: { url: string; downloadUrl: string; expiresAt: string | null } | null;
  aiGenerated: true;
}

const SIGNED_URL_TTL = 60 * 60;

export async function toJobView(job: JobRow, templateName: string, templateSlug: string): Promise<JobView> {
  let result: JobView["result"] = null;
  if (job.status === "COMPLETED" && job.result_storage_key && !job.result_deleted_at) {
    const storage = getStorage();
    const fileName = `trend-machine-${templateSlug}-ai.mp4`;
    result = {
      url: await storage.signedUrl(job.result_storage_key, { ttlSeconds: SIGNED_URL_TTL }),
      downloadUrl: await storage.signedUrl(job.result_storage_key, {
        ttlSeconds: SIGNED_URL_TTL,
        downloadName: fileName,
      }),
      expiresAt: job.result_expires_at ? new Date(job.result_expires_at).toISOString() : null,
    };
  }
  const deleted = job.status === "COMPLETED" && !!job.result_deleted_at;
  return {
    id: job.id,
    status: deleted ? "FAILED" : job.status,
    progress: job.progress,
    error: deleted
      ? userFacingError("RESULT_UNAVAILABLE")
      : job.error_code
        ? userFacingError(job.error_code)
        : null,
    blockers: job.routing?.blockers ?? [],
    template: { id: job.template_id, slug: templateSlug, name: templateName, version: job.template_version },
    createdAt: new Date(job.created_at).toISOString(),
    updatedAt: new Date(job.updated_at).toISOString(),
    completedAt: job.completed_at ? new Date(job.completed_at).toISOString() : null,
    regenerateOf: job.regenerate_of,
    result,
    aiGenerated: true,
  };
}

export async function jobViewFor(q: Queryable, job: JobRow): Promise<JobView> {
  const rec = await getTemplateVersion(q, job.template_version_id);
  return toJobView(job, rec?.spec.name ?? "Dance", rec?.slug ?? "dance");
}

/* ------------------------------------------------------------------------- */
/* Request                                                                    */
/* ------------------------------------------------------------------------- */

export class GenerationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: GenerationErrorCode,
    message: string,
    readonly publicMessage?: string,
  ) {
    super(message);
    this.name = "GenerationRequestError";
  }
}

export interface GenerationInput {
  ownerHash: string;
  anonId: string;
  ipHash: string;
  deviceClass: string;
  templateSlug: string;
  /** Optional when regenerating: defaults to the previous job's photo. */
  uploadId: string | null;
  idempotencyKey: string;
  rightsConfirmed: boolean;
  regenerateOf?: string | null;
}

async function enforceLimits(q: Queryable, input: GenerationInput): Promise<void> {
  const cfg = getConfig();
  if (!cfg.GENERATION_ENABLED) {
    throw new GenerationRequestError(
      503,
      "RATE_LIMITED",
      "generation disabled",
      "Video generation is paused right now. Please try again later.",
    );
  }
  const [c] = await q.query<{
    dev_hour: number;
    dev_day: number;
    ip_day: number;
    global_day: number;
    dev_active: number;
    global_active: number;
    cost_day: string | null;
  }>(
    `select
       count(*) filter (where owner_hash = $1 and created_at > now() - interval '1 hour' and provider_job_id is not null)::int as dev_hour,
       count(*) filter (where owner_hash = $1 and created_at > now() - interval '1 day' and provider_job_id is not null)::int as dev_day,
       count(*) filter (where ip_hash = $2 and created_at > now() - interval '1 day' and provider_job_id is not null)::int as ip_day,
       count(*) filter (where created_at > now() - interval '1 day' and provider_job_id is not null)::int as global_day,
       count(*) filter (where owner_hash = $1 and status in ('QUEUED','PROCESSING'))::int as dev_active,
       count(*) filter (where status in ('QUEUED','PROCESSING'))::int as global_active,
       sum(cost_usd) filter (where created_at > now() - interval '1 day') as cost_day
     from generation_jobs
     where created_at > now() - interval '1 day' or status in ('QUEUED','PROCESSING')`,
    [input.ownerHash, input.ipHash],
  );
  if (!c) return;
  const limited = (why: string) => {
    throw new GenerationRequestError(429, "RATE_LIMITED", `rate limited: ${why}`);
  };
  if (c.dev_active >= cfg.MAX_ACTIVE_JOBS_PER_DEVICE) {
    throw new GenerationRequestError(
      429,
      "RATE_LIMITED",
      "device concurrency",
      "You already have videos in progress. Wait for one to finish before starting another.",
    );
  }
  if (c.dev_hour >= cfg.GEN_LIMIT_PER_DEVICE_HOUR) limited("device hourly");
  if (c.dev_day >= cfg.GEN_LIMIT_PER_DEVICE_DAY) limited("device daily");
  if (c.ip_day >= cfg.GEN_LIMIT_PER_IP_DAY) limited("ip daily");
  if (c.global_day >= cfg.GEN_LIMIT_GLOBAL_DAY) {
    throw new GenerationRequestError(
      503,
      "RATE_LIMITED",
      "global daily cap",
      "We've hit today's video limit. Please try again tomorrow.",
    );
  }
  if (c.global_active >= cfg.MAX_ACTIVE_JOBS_GLOBAL) {
    throw new GenerationRequestError(
      503,
      "RATE_LIMITED",
      "global concurrency",
      "Lots of people are dancing right now. Try again in a minute.",
    );
  }
  if (cfg.DAILY_BUDGET_USD !== undefined && Number(c.cost_day ?? 0) >= cfg.DAILY_BUDGET_USD) {
    throw new GenerationRequestError(
      503,
      "RATE_LIMITED",
      "daily budget reached",
      "We've hit today's video limit. Please try again tomorrow.",
    );
  }
}

export interface RequestResult {
  job: JobRow;
  created: boolean;
  /** True when the job still needs provider submission (caller schedules dispatch). */
  needsDispatch: boolean;
}

export async function requestGeneration(input: GenerationInput, dbIn?: Db): Promise<RequestResult> {
  const db = dbIn ?? (await getDb());
  if (!input.rightsConfirmed) {
    throw new GenerationRequestError(
      400,
      "INVALID_INPUT",
      "rights not confirmed",
      "Please confirm you have permission to use this photo.",
    );
  }
  const existing = await db.query<JobRow>(
    "select * from generation_jobs where owner_hash = $1 and idempotency_key = $2",
    [input.ownerHash, input.idempotencyKey],
  );
  if (existing[0]) return { job: existing[0], created: false, needsDispatch: false };

  const rec = await getTemplateBySlug(db, input.templateSlug);
  if (!rec || !PUBLIC_STATUSES.includes(rec.status)) {
    throw new GenerationRequestError(
      404,
      "INVALID_INPUT",
      "template not found",
      "That dance isn't available.",
    );
  }
  let uploadId = input.uploadId;
  if (input.regenerateOf) {
    const prev = await getOwnedJob(db, input.regenerateOf, input.ownerHash);
    if (!prev) throw new GenerationRequestError(404, "INVALID_INPUT", "regenerate target not found");
    if (prev.template_id !== rec.id)
      throw new GenerationRequestError(400, "INVALID_INPUT", "regenerate template mismatch");
    uploadId ??= prev.upload_id;
  }
  if (!uploadId) {
    throw new GenerationRequestError(
      400,
      "UPLOAD_FAILED",
      "no upload",
      "Your photo has expired. Please add it again.",
    );
  }
  const [upload] = await db.query<{ id: string; expires_at: Date }>(
    "select id, expires_at from uploads where id = $1 and owner_hash = $2 and deleted_at is null",
    [uploadId, input.ownerHash],
  );
  if (!upload || new Date(upload.expires_at) < new Date()) {
    throw new GenerationRequestError(
      400,
      "UPLOAD_FAILED",
      "upload missing/expired",
      "Your photo has expired. Please add it again.",
    );
  }

  const readiness = await evaluateReadiness(db, rec);

  // Only jobs that could actually spend money count against limits — but a blocked
  // request is still recorded truthfully as a failed job.
  if (readiness.ready) await enforceLimits(db, input);

  const deadlineSeconds = rec.spec.recipe.timeoutSeconds + 180; // + submission/upload allowance
  const templateEvent = {
    templateId: rec.id,
    templateVersion: rec.version,
    anonId: input.anonId,
    deviceClass: input.deviceClass as never,
  };

  const job = await db.tx(async (q) => {
    const rows = await q.query<JobRow>(
      `insert into generation_jobs (owner_hash, ip_hash, idempotency_key, template_id, template_version_id, template_version,
         upload_id, regenerate_of, status, routing, provenance, device_class, deadline_at, next_poll_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'QUEUED',$9,$10,$11, now() + make_interval(secs => $12), now())
       on conflict (owner_hash, idempotency_key) do nothing
       returning *`,
      [
        input.ownerHash,
        input.ipHash,
        input.idempotencyKey,
        rec.id,
        rec.versionId,
        rec.version,
        upload.id,
        input.regenerateOf ?? null,
        JSON.stringify({
          blockers: readiness.blockers,
          candidates: readiness.routing.candidates,
          rejected: readiness.routing.rejected,
          attempts: [],
        }),
        JSON.stringify({
          generator: "TREND MACHINE",
          aiGenerated: true,
          templateId: rec.id,
          templateVersion: rec.version,
        }),
        input.deviceClass,
        deadlineSeconds,
      ],
    );
    return rows[0] ?? null;
  });
  if (!job) {
    const again = await db.query<JobRow>(
      "select * from generation_jobs where owner_hash = $1 and idempotency_key = $2",
      [input.ownerHash, input.idempotencyKey],
    );
    return { job: again[0]!, created: false, needsDispatch: false };
  }
  await track(db, {
    name: "generation_requested",
    jobId: job.id,
    ...templateEvent,
    props: { regenerate: !!input.regenerateOf },
  });

  if (!readiness.ready) {
    const code: GenerationErrorCode =
      readiness.blockers[0]?.code ?? readiness.routing.blocker ?? "PROVIDER_NOT_CONFIGURED";
    const failed = await failJob(
      db,
      job,
      code,
      `not ready: ${readiness.blockers.map((b) => b.code).join(",")}`,
    );
    return { job: failed ?? job, created: true, needsDispatch: false };
  }
  return { job, created: true, needsDispatch: true };
}

/** Per-job webhook capability token: HMAC of the job id, so nothing needs storing. */
export function webhookToken(jobId: string): string {
  return hmacB64(getConfig().appSecret, "webhook", jobId);
}

/* ------------------------------------------------------------------------- */
/* Failure / completion helpers                                              */
/* ------------------------------------------------------------------------- */

async function failJob(
  db: Db,
  job: JobRow,
  code: GenerationErrorCode,
  detail: string,
): Promise<JobRow | null> {
  const row = await transition(db, job.id, "FAILED", {
    error_code: code,
    error_detail: detail.slice(0, 1000),
    failed_at: new Date(),
    dispatch_lease_until: null,
    poll_lease_until: null,
    next_poll_at: null,
  });
  if (row) {
    await track(db, {
      name: "generation_failed",
      jobId: row.id,
      templateId: row.template_id,
      templateVersion: row.template_version,
      providerId: row.provider_id,
      providerModel: row.provider_model,
      errorCode: code,
      latencyMs: Date.now() - new Date(row.created_at).getTime(),
      deviceClass: row.device_class as never,
    });
  }
  return row;
}

/* ------------------------------------------------------------------------- */
/* Dispatch (provider submission)                                             */
/* ------------------------------------------------------------------------- */

const MAX_SUBMIT_ATTEMPTS = 2;

/**
 * Submit a queued job to a provider. Safe to call concurrently / repeatedly:
 * an atomic lease guarantees a single submitter, and an interrupted submission is
 * never blindly repeated (it could double-bill).
 */
export async function dispatchJob(jobId: string, dbIn?: Db): Promise<JobRow | null> {
  const db = dbIn ?? (await getDb());
  const [claimed] = await db.query<JobRow>(
    `update generation_jobs
       set dispatch_lease_until = now() + interval '3 minutes', submit_attempts = submit_attempts + 1,
           provider_status = 'SUBMITTING', updated_at = now()
     where id = $1 and status = 'QUEUED' and provider_job_id is null
       and (dispatch_lease_until is null or dispatch_lease_until < now())
       and coalesce(provider_status, '') <> 'SUBMITTING'
       and submit_attempts < $2
       and (next_poll_at is null or next_poll_at <= now())
     returning *`,
    [jobId, MAX_SUBMIT_ATTEMPTS],
  );
  if (!claimed) return getJob(db, jobId);
  const job = claimed;

  try {
    const rec = await getTemplateVersion(db, job.template_version_id);
    if (!rec) return failJob(db, job, "INTERNAL_ERROR", "template version missing");
    const ref = rec.reference;
    if (!ref || ref.status !== "READY")
      return failJob(db, job, "REFERENCE_MOTION_NOT_READY", "reference not ready at dispatch");

    const readiness = await evaluateReadiness(db, rec);
    if (readiness.routing.candidates.length === 0) {
      return failJob(db, job, readiness.routing.blocker ?? "PROVIDER_NOT_CONFIGURED", "no route at dispatch");
    }

    const [upload] = await db.query<{ storage_key: string; content_type: string }>(
      "select storage_key, content_type from uploads where id = $1 and deleted_at is null",
      [job.upload_id],
    );
    if (!upload) return failJob(db, job, "UPLOAD_FAILED", "upload gone at dispatch");
    const storage = getStorage();
    const cfg = getConfig();
    const image = await storage.read(upload.storage_key, cfg.MAX_UPLOAD_BYTES);
    const video = await storage.read(ref.storage_key, 150 * 1024 * 1024);
    if (!image) return failJob(db, job, "UPLOAD_FAILED", "upload object missing");
    if (!video) return failJob(db, job, "REFERENCE_MOTION_NOT_READY", "reference object missing");

    const attempts: unknown[] = [];
    let lastError: ProviderError | null = null;
    const failedProviders = new Set<string>();
    for (const cand of readiness.routing.candidates) {
      const provider = getProvider(cand.providerId);
      // A provider-level failure (credentials, capacity, availability) applies to all its models.
      if (!provider || failedProviders.has(cand.providerId)) continue;
      const webhookUrl =
        provider.getCapabilities().supportsWebhook && cfg.PUBLIC_BASE_URL?.startsWith("https://")
          ? `${cfg.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/webhooks/${provider.id}/${job.id}?t=${encodeURIComponent(webhookToken(job.id))}`
          : undefined;
      try {
        const sub = await provider.createJob({
          jobId: job.id,
          model: cand.model,
          capability: rec.spec.recipe.capability,
          image: {
            data: image.data,
            contentType: image.contentType,
            filename: `photo.${upload.storage_key.split(".").pop()}`,
          },
          referenceVideo: {
            data: video.data,
            contentType: "video/mp4",
            filename: "reference.mp4",
            durationSeconds: ref.duration_seconds !== null ? Number(ref.duration_seconds) : null,
          },
          prompt: rec.spec.recipe.prompt,
          characterOrientation: rec.spec.recipe.characterOrientation,
          keepReferenceAudio: false,
          webhookUrl,
          config: rec.spec.providerConfig[cand.providerId] ?? {},
        });
        attempts.push({
          providerId: cand.providerId,
          model: cand.model,
          ok: true,
          at: new Date().toISOString(),
        });
        const toStatus: JobStatus = sub.state === "PROCESSING" ? "PROCESSING" : "QUEUED";
        const patch = {
          provider_id: cand.providerId,
          provider_model: cand.model,
          provider_job_id: sub.providerJobId,
          provider_status: sub.state.toLowerCase(),
          submitted_at: new Date(),
          started_at: toStatus === "PROCESSING" ? new Date() : null,
          next_poll_at: new Date(Date.now() + 4000),
          dispatch_lease_until: null,
          cost_usd: sub.cost?.usd ?? null,
          cost_source: sub.cost?.source ?? null,
          routing: { ...job.routing, attempts },
          provenance: { ...job.provenance, providerId: cand.providerId, providerModel: cand.model },
        };
        const updated =
          toStatus === "PROCESSING"
            ? await transition(db, job.id, "PROCESSING", patch)
            : await patchJob(db, job.id, patch, ["QUEUED"]);
        const ev = {
          jobId: job.id,
          templateId: job.template_id,
          templateVersion: job.template_version,
          providerId: cand.providerId,
          providerModel: cand.model,
          costUsd: sub.cost?.usd ?? null,
          deviceClass: job.device_class as never,
        };
        await track(db, { name: "generation_queued", ...ev });
        if (toStatus === "PROCESSING") await track(db, { name: "generation_processing", ...ev });
        return updated;
      } catch (e) {
        const err =
          e instanceof ProviderError
            ? e
            : new ProviderError({ code: "INTERNAL_ERROR", message: String(e), accepted: "UNKNOWN" });
        lastError = err;
        failedProviders.add(cand.providerId);
        attempts.push({
          providerId: cand.providerId,
          model: cand.model,
          ok: false,
          code: err.code,
          providerCode: err.providerCode ?? null,
          httpStatus: err.httpStatus ?? null,
          at: new Date().toISOString(),
        });
        if (err.accepted === "UNKNOWN") {
          // The provider may have accepted (and billed) this job. Never resubmit.
          await patchJob(db, job.id, { routing: { ...job.routing, attempts } }, ["QUEUED"]);
          return failJob(db, job, "PROVIDER_FAILED", `ambiguous submission: ${err.message}`);
        }
        if (err.providerUnavailable) {
          openCircuit(cand.providerId);
          continue; // try fallback
        }
        if (err.retryable) continue; // capacity/transient: try next candidate
        break; // definitive rejection (e.g. content): don't shop it around to other providers
      }
    }

    // Nothing accepted the job.
    const err = lastError;
    await patchJob(db, job.id, { routing: { ...job.routing, attempts } }, ["QUEUED"]);
    if (err && err.retryable && !err.providerUnavailable && job.submit_attempts < MAX_SUBMIT_ATTEMPTS) {
      // Definitely not accepted + transient: allow one more attempt after a pause.
      return patchJob(
        db,
        job.id,
        {
          provider_status: "SUBMIT_REJECTED",
          dispatch_lease_until: null,
          next_poll_at: new Date(Date.now() + 20_000),
        },
        ["QUEUED"],
      );
    }
    return failJob(
      db,
      job,
      err?.code ?? "PROVIDER_FAILED",
      `submission failed: ${err?.message ?? "no candidate"}`,
    );
  } catch (e) {
    console.error("[dispatch] unexpected error", e instanceof Error ? e.message : e);
    return failJob(
      db,
      job,
      "INTERNAL_ERROR",
      `dispatch crashed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/* ------------------------------------------------------------------------- */
/* Refresh (controlled polling)                                              */
/* ------------------------------------------------------------------------- */

function backoffMs(pollCount: number): number {
  const base = Math.min(2000 * 1.5 ** pollCount, 10_000);
  return Math.round(base + Math.random() * 500);
}

/**
 * Advance a job by at most one provider status check. Called by the status API
 * (client polling), the cron endpoint, the worker and webhooks. A lease + next_poll_at
 * gate means provider polling is bounded no matter how many callers there are.
 */
export async function refreshJob(
  jobId: string,
  opts: { force?: boolean; db?: Db } = {},
): Promise<JobRow | null> {
  const db = opts.db ?? (await getDb());
  let job = await getJob(db, jobId);
  if (!job || isTerminal(job.status)) return job;

  // Hard deadline regardless of provider state.
  if (job.deadline_at && new Date(job.deadline_at) < new Date()) {
    if (job.provider_id && job.provider_job_id) {
      const p = getProvider(job.provider_id);
      await p?.cancelJob?.(job.provider_job_id).catch(() => undefined);
    }
    return failJob(db, job, "TIMEOUT", "deadline exceeded");
  }

  if (!job.provider_job_id) {
    if (
      job.provider_status === "SUBMITTING" &&
      job.dispatch_lease_until &&
      new Date(job.dispatch_lease_until) < new Date()
    ) {
      // A submitter died mid-request. We can't know if the provider accepted it.
      return failJob(
        db,
        job,
        "PROVIDER_FAILED",
        "submission interrupted; not resubmitting to avoid double billing",
      );
    }
    return dispatchJob(job.id, db);
  }

  const [claimed] = await db.query<JobRow>(
    `update generation_jobs
        set poll_lease_until = now() + interval '45 seconds', poll_count = poll_count + 1, updated_at = now()
      where id = $1 and status in ('QUEUED','PROCESSING') and provider_job_id is not null
        and (poll_lease_until is null or poll_lease_until < now())
        and ($2::boolean or next_poll_at is null or next_poll_at <= now())
      returning *`,
    [job.id, !!opts.force],
  );
  if (!claimed) return job;
  job = claimed;

  const provider = getProvider(job.provider_id!);
  if (!provider) return failJob(db, job, "INTERNAL_ERROR", `provider ${job.provider_id} not registered`);

  // Output already known (a previous finalize attempt failed): retry the copy only.
  if (job.provider_output_url) return finalizeJob(db, job, job.provider_output_url);

  let status: ProviderJobStatus;
  try {
    status = await provider.getJob(job.provider_job_id!);
  } catch (e) {
    const err =
      e instanceof ProviderError
        ? e
        : new ProviderError({ code: "INTERNAL_ERROR", message: String(e), retryable: true });
    if (err.providerUnavailable) openCircuit(provider.id);
    if (err.retryable || err.code === "PROVIDER_NOT_CONFIGURED") {
      return patchJob(
        db,
        job.id,
        { poll_lease_until: null, next_poll_at: new Date(Date.now() + backoffMs(job.poll_count + 2)) },
        ["QUEUED", "PROCESSING"],
      );
    }
    return failJob(db, job, err.code, `status check failed: ${err.message}`);
  }

  const common = { provider_status: status.rawStatus, progress: status.progress, poll_lease_until: null };
  switch (status.state) {
    case "QUEUED":
      return patchJob(
        db,
        job.id,
        { ...common, next_poll_at: new Date(Date.now() + backoffMs(job.poll_count)) },
        ["QUEUED", "PROCESSING"],
      );
    case "PROCESSING": {
      if (job.status === "QUEUED") {
        const moved = await transition(db, job.id, "PROCESSING", {
          ...common,
          started_at: new Date(),
          next_poll_at: new Date(Date.now() + backoffMs(job.poll_count)),
        });
        if (moved) {
          await track(db, {
            name: "generation_processing",
            jobId: job.id,
            templateId: job.template_id,
            templateVersion: job.template_version,
            providerId: job.provider_id,
            providerModel: job.provider_model,
            deviceClass: job.device_class as never,
          });
        }
        return moved;
      }
      return patchJob(
        db,
        job.id,
        { ...common, next_poll_at: new Date(Date.now() + backoffMs(job.poll_count)) },
        ["PROCESSING"],
      );
    }
    case "COMPLETED":
      return finalizeJob(db, job, status.outputUrl!);
    case "CANCELED":
      return failJob(db, job, "PROVIDER_FAILED", "canceled by provider");
    case "FAILED":
    default:
      return failJob(
        db,
        job,
        status.error?.code ?? "PROVIDER_FAILED",
        status.error?.message ?? "provider failed",
      );
  }
}

const MAX_FINALIZE_ATTEMPTS = 3;

/** Copy the provider's (short-lived) output into our private storage, then complete. */
async function finalizeJob(db: Db, job: JobRow, outputUrl: string): Promise<JobRow | null> {
  const cfg = getConfig();
  const allowInsecure = !cfg.isProduction && process.env.ALLOW_INSECURE_PROVIDER_URLS === "true";
  try {
    if (!allowInsecure && !isSafeOutputUrl(outputUrl)) throw new Error("unsafe output url");
    const res = await fetch(outputUrl, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`download failed ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > cfg.MAX_RESULT_BYTES) throw new Error("result too large");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cfg.MAX_RESULT_BYTES) {
        await reader.cancel();
        throw new Error("result too large");
      }
      chunks.push(value);
    }
    const data = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      data.set(c, o);
      o += c.byteLength;
    }
    // Verify it's actually an MP4 container (ftyp box) before storing.
    if (data.byteLength < 12 || String.fromCharCode(...data.subarray(4, 8)) !== "ftyp")
      throw new Error("result is not mp4");
    const key = newKey("results", job.id.replace(/-/g, ""), "video/mp4");
    await getStorage().put(key, data, "video/mp4");
    const completedAt = new Date();
    const done = await transition(db, job.id, "COMPLETED", {
      result_storage_key: key,
      result_content_type: "video/mp4",
      result_bytes: total,
      result_expires_at: new Date(completedAt.getTime() + cfg.RESULT_RETENTION_DAYS * 86400_000),
      completed_at: completedAt,
      provider_output_url: null,
      progress: 100,
      poll_lease_until: null,
      next_poll_at: null,
      provenance: {
        ...job.provenance,
        completedAt: completedAt.toISOString(),
        watermark: "none",
        contentCredentials: "not_implemented",
      },
    });
    if (done) {
      await track(db, {
        name: "generation_completed",
        jobId: job.id,
        templateId: job.template_id,
        templateVersion: job.template_version,
        providerId: job.provider_id,
        providerModel: job.provider_model,
        latencyMs: completedAt.getTime() - new Date(job.created_at).getTime(),
        costUsd: job.cost_usd !== null ? Number(job.cost_usd) : null,
        deviceClass: job.device_class as never,
      });
    }
    return done;
  } catch (e) {
    const attempts = job.finalize_attempts + 1;
    if (attempts >= MAX_FINALIZE_ATTEMPTS) {
      return failJob(
        db,
        job,
        "RESULT_UNAVAILABLE",
        `finalize failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return patchJob(
      db,
      job.id,
      {
        finalize_attempts: attempts,
        provider_output_url: outputUrl,
        poll_lease_until: null,
        next_poll_at: new Date(Date.now() + 5000 * attempts),
      },
      ["QUEUED", "PROCESSING"],
    );
  }
}

/* ------------------------------------------------------------------------- */
/* Background advancement + webhooks + cancel                                 */
/* ------------------------------------------------------------------------- */

export async function advanceActiveJobs(limit = 25, dbIn?: Db): Promise<{ checked: number }> {
  const db = dbIn ?? (await getDb());
  const rows = await db.query<{ id: string }>(
    `select id from generation_jobs where status in ('QUEUED','PROCESSING')
       and (next_poll_at is null or next_poll_at <= now() or deadline_at < now())
     order by next_poll_at nulls first limit $1`,
    [limit],
  );
  for (const r of rows) {
    try {
      await refreshJob(r.id, { db });
    } catch (e) {
      console.error("[advance] job refresh failed", r.id, e instanceof Error ? e.message : e);
    }
  }
  return { checked: rows.length };
}

export async function handleWebhook(
  providerId: string,
  jobId: string,
  token: string,
  body: unknown,
): Promise<boolean> {
  const db = await getDb();
  const job = await getJob(db, jobId);
  if (!job || job.provider_id !== providerId) return false;
  if (!safeEqual(webhookToken(jobId), token)) return false;
  const provider = getProvider(providerId);
  const claimedId = provider?.webhookJobId?.(body);
  if (claimedId && claimedId !== job.provider_job_id) return false;
  // Webhook bodies are unsigned: treat as a hint and re-fetch authoritative status.
  await refreshJob(jobId, { force: true, db });
  return true;
}

export async function cancelJob(jobId: string, ownerHash: string): Promise<JobRow | null> {
  const db = await getDb();
  const job = await getOwnedJob(db, jobId, ownerHash);
  if (!job || isTerminal(job.status)) return job;
  if (job.provider_id && job.provider_job_id) {
    const p = getProvider(job.provider_id);
    await p?.cancelJob?.(job.provider_job_id).catch(() => undefined);
  }
  return transition(db, job.id, "CANCELED", {
    dispatch_lease_until: null,
    poll_lease_until: null,
    next_poll_at: null,
  });
}
