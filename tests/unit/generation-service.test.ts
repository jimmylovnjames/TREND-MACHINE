import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceActiveJobs,
  dispatchJob,
  GenerationRequestError,
  jobViewFor,
  refreshJob,
  requestGeneration,
  type GenerationInput,
} from "@/server/generation/service";
import { getJob } from "@/server/generation/jobs";
import { ProviderError } from "@/server/providers/types";
import { approveReferenceAsset, registerReferenceAsset, SUITABILITY_CHECKS } from "@/server/reference";
import { deleteDeviceData, runRetention } from "@/server/retention";
import { saveSourcePhoto } from "@/server/uploads/service";
import { createHarness, type Harness } from "../helpers/harness";
import { makeMp4 } from "../helpers/mp4";
import { figurePng } from "../helpers/png";
import { completed, failed, ScriptedProvider } from "../helpers/test-provider";

const OWNER = "owner-hash-aaaaaaaaaaaaaaaa";
const ALL_CHECKS = Object.fromEntries(SUITABILITY_CHECKS.map((c) => [c, true]));
const MP4_OUT = makeMp4({ seconds: 7 });

let h: Harness;
let hf: ScriptedProvider;
let vg: ScriptedProvider;

async function readyReference(template = "tpl_glitch_walk", opts: { audio?: boolean } = {}) {
  const ref = await registerReferenceAsset(h.db, makeMp4({ seconds: 7, audio: opts.audio }), {
    templateId: template,
    creator: "Test Performer",
    owner: "TREND MACHINE",
    creationMethod: "STUDIO_CAPTURE",
    license: "work for hire",
    permissionEvidence: "release #1",
    capturedOn: "2026-09-01",
    notes: "",
  });
  await approveReferenceAsset(h.db, ref.id, "reviewer", ALL_CHECKS);
  return ref.id;
}

async function input(over: Partial<GenerationInput> = {}): Promise<GenerationInput> {
  const up = over.uploadId ? null : await saveSourcePhoto(h.db, over.ownerHash ?? OWNER, figurePng());
  return {
    ownerHash: OWNER,
    anonId: "anon",
    ipHash: "ip",
    deviceClass: "mobile",
    templateSlug: "glitch-walk",
    uploadId: up?.id ?? null,
    idempotencyKey: randomBytes(12).toString("base64url"),
    rightsConfirmed: true,
    ...over,
  };
}

async function makeDue(jobId: string) {
  await h.db.query(
    "update generation_jobs set next_poll_at = now() - interval '1 second', poll_lease_until = null where id = $1",
    [jobId],
  );
}

async function events(name: string) {
  return h.db.query<{
    name: string;
    error_code: string | null;
    provider_id: string | null;
    cost_usd: string | null;
  }>("select * from analytics_events where name = $1", [name]);
}

beforeEach(async () => {
  hf = new ScriptedProvider("higgsfield");
  vg = new ScriptedProvider("viggle", ["viggle/v1/render"], { canDropAudio: false });
  h = await createHarness([hf, vg], { GEN_LIMIT_PER_DEVICE_HOUR: "3", MAX_ACTIVE_JOBS_PER_DEVICE: "2" });
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).startsWith("https://cdn.provider.test/"))
      return new Response(MP4_OUT as unknown as BodyInit, {
        status: 200,
        headers: { "content-length": String(MP4_OUT.length) },
      });
    if (String(url).startsWith("https://cdn.provider.test-bad/"))
      return new Response("<html>nope</html>", { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await h.cleanup();
});

describe("readiness failures are truthful and free", () => {
  it("REFERENCE_MOTION_NOT_READY when no approved reference exists (and nothing is sent to providers)", async () => {
    const r = await requestGeneration(await input());
    expect(r.needsDispatch).toBe(false);
    expect(r.job.status).toBe("FAILED");
    expect(r.job.error_code).toBe("REFERENCE_MOTION_NOT_READY");
    expect(hf.createCalls).toHaveLength(0);
    const view = await jobViewFor(h.db, r.job);
    expect(view.error?.code).toBe("REFERENCE_MOTION_NOT_READY");
    expect(view.blockers.map((b) => b.code)).toEqual(["REFERENCE_MOTION_NOT_READY"]);
  });

  it("PROVIDER_NOT_CONFIGURED when a reference is ready but no provider has credentials", async () => {
    await readyReference();
    hf.configured = false;
    vg.configured = false;
    const r = await requestGeneration(await input());
    expect(r.job.status).toBe("FAILED");
    expect(r.job.error_code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(hf.createCalls).toHaveLength(0);
    expect((await events("generation_failed"))[0]!.error_code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("reports both blockers when both are missing", async () => {
    hf.configured = false;
    vg.configured = false;
    const r = await requestGeneration(await input());
    const view = await jobViewFor(h.db, r.job);
    expect(view.blockers.map((b) => b.code).sort()).toEqual([
      "PROVIDER_NOT_CONFIGURED",
      "REFERENCE_MOTION_NOT_READY",
    ]);
  });

  it("requires rights confirmation", async () => {
    await expect(requestGeneration(await input({ rightsConfirmed: false }))).rejects.toBeInstanceOf(
      GenerationRequestError,
    );
  });

  it("rejects another device's upload", async () => {
    const other = await saveSourcePhoto(h.db, "someone-else", figurePng());
    await expect(requestGeneration(await input({ uploadId: other.id }))).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
    });
  });
});

describe("generation pipeline", () => {
  it("runs QUEUED → PROCESSING → COMPLETED, stores the result privately and records analytics + cost", async () => {
    await readyReference();
    hf.statuses = [
      () => ({ state: "QUEUED", rawStatus: "queued", progress: null, outputUrl: null, error: null }),
      () => ({ state: "PROCESSING", rawStatus: "in_progress", progress: 40, outputUrl: null, error: null }),
      completed(),
    ];
    const r = await requestGeneration(await input());
    expect(r.job.status).toBe("QUEUED");
    expect(r.needsDispatch).toBe(true);
    let job = await dispatchJob(r.job.id);
    expect(job!.provider_id).toBe("higgsfield");
    expect(job!.provider_model).toBe("kling-video/v3/motion-control/std");
    expect(hf.createCalls).toHaveLength(1);
    expect(hf.createCalls[0]!.keepReferenceAudio).toBe(false);
    expect(hf.createCalls[0]!.image.contentType).toBe("image/png");

    for (const expected of ["QUEUED", "PROCESSING", "COMPLETED"]) {
      await makeDue(r.job.id);
      job = await refreshJob(r.job.id);
      expect(job!.status).toBe(expected);
    }
    expect(job!.result_storage_key).toMatch(/^results\/[a-f0-9]+\.mp4$/);
    expect(existsSync(path.join(h.storageDir, job!.result_storage_key!))).toBe(true);
    expect(Number(job!.cost_usd)).toBeCloseTo(0.42);

    const view = await jobViewFor(h.db, job!);
    expect(view.result?.url).toMatch(/^\/api\/media\/results\/.+\?exp=\d+&sig=/);
    expect(view.result?.downloadUrl).toContain("dl=trend-machine-glitch-walk-ai.mp4");
    expect(view.aiGenerated).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/higgsfield|cdn\.provider/); // no vendor / provider URLs to clients

    for (const name of [
      "generation_requested",
      "generation_queued",
      "generation_processing",
      "generation_completed",
    ]) {
      expect((await events(name)).length, name).toBe(1);
    }
    const [done] = await events("generation_completed");
    expect(done!.provider_id).toBe("higgsfield");
    const transitions = await h.db.query<{ to_status: string }>(
      "select to_status from generation_job_transitions where job_id = $1 order by id",
      [r.job.id],
    );
    expect(transitions.map((t) => t.to_status)).toEqual(["PROCESSING", "COMPLETED"]);
  });

  it("is idempotent per (device, idempotency key)", async () => {
    await readyReference();
    const i = await input();
    const a = await requestGeneration(i);
    const b = await requestGeneration(i);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(b.needsDispatch).toBe(false);
  });

  it("dispatch is single-flight: concurrent dispatchers submit exactly once", async () => {
    await readyReference();
    const r = await requestGeneration(await input());
    await Promise.all([
      dispatchJob(r.job.id),
      dispatchJob(r.job.id),
      refreshJob(r.job.id),
      advanceActiveJobs(),
    ]);
    expect(hf.createCalls).toHaveLength(1);
  });

  it("never resubmits after an ambiguous submission (no double billing)", async () => {
    await readyReference();
    hf.submit = async () => {
      throw new ProviderError({
        code: "PROVIDER_FAILED",
        message: "timeout after send",
        accepted: "UNKNOWN",
      });
    };
    const r = await requestGeneration(await input());
    const job = await dispatchJob(r.job.id);
    expect(job!.status).toBe("FAILED");
    expect(job!.error_code).toBe("PROVIDER_FAILED");
    await makeDue(r.job.id);
    await refreshJob(r.job.id);
    await advanceActiveJobs();
    expect(hf.createCalls).toHaveLength(1);
    expect(vg.createCalls).toHaveLength(0);
  });

  it("fails an interrupted submission instead of resubmitting", async () => {
    await readyReference();
    const r = await requestGeneration(await input());
    // Simulate a worker that died mid-submit: lease expired while SUBMITTING.
    await h.db.query(
      "update generation_jobs set provider_status = 'SUBMITTING', submit_attempts = 1, dispatch_lease_until = now() - interval '1 minute' where id = $1",
      [r.job.id],
    );
    const job = await refreshJob(r.job.id);
    expect(job!.status).toBe("FAILED");
    expect(hf.createCalls).toHaveLength(0);
  });

  it("falls back to the fallback provider when the primary is unavailable", async () => {
    await readyReference(); // silent reference → Viggle is eligible
    hf.submit = async () => {
      throw new ProviderError({ code: "PROVIDER_NOT_CONFIGURED", message: "401", providerUnavailable: true });
    };
    const r = await requestGeneration(await input());
    const job = await dispatchJob(r.job.id);
    expect(job!.provider_id).toBe("viggle");
    expect(hf.createCalls).toHaveLength(1); // circuit opened: std not retried on pro
    expect(vg.createCalls).toHaveLength(1);
    const attempts = job!.routing.attempts as { providerId: string; ok: boolean }[];
    expect(attempts.map((a) => [a.providerId, a.ok])).toEqual([
      ["higgsfield", false],
      ["viggle", true],
    ]);
  });

  it("does not shop a content rejection around to other providers", async () => {
    await readyReference();
    hf.submit = async () => {
      throw new ProviderError({ code: "PROVIDER_REJECTED", message: "image rejected" });
    };
    const r = await requestGeneration(await input());
    const job = await dispatchJob(r.job.id);
    expect(job!.error_code).toBe("PROVIDER_REJECTED");
    expect(vg.createCalls).toHaveLength(0);
  });

  it("normalizes provider terminal errors", async () => {
    await readyReference();
    hf.statuses = [failed(new ProviderError({ code: "PROVIDER_REJECTED", message: "nsfw" }))];
    const r = await requestGeneration(await input());
    await dispatchJob(r.job.id);
    await makeDue(r.job.id);
    const job = await refreshJob(r.job.id);
    expect(job).toMatchObject({ status: "FAILED", error_code: "PROVIDER_REJECTED" });
    expect((await jobViewFor(h.db, job!)).error?.actions).toContain("CHANGE_PHOTO");
  });

  it("times out at the deadline and cancels at the provider", async () => {
    await readyReference();
    const r = await requestGeneration(await input());
    await dispatchJob(r.job.id);
    await h.db.query("update generation_jobs set deadline_at = now() - interval '1 second' where id = $1", [
      r.job.id,
    ]);
    const job = await refreshJob(r.job.id);
    expect(job).toMatchObject({ status: "FAILED", error_code: "TIMEOUT" });
    expect(hf.cancelCalls).toBe(1);
  });

  it("bounds provider polling with next_poll_at regardless of caller count", async () => {
    await readyReference();
    const r = await requestGeneration(await input());
    await dispatchJob(r.job.id);
    await makeDue(r.job.id);
    await Promise.all(Array.from({ length: 10 }, () => refreshJob(r.job.id)));
    expect(hf.getCalls).toBe(1);
  });

  it("rejects non-MP4 provider output and gives up after bounded retries", async () => {
    await readyReference();
    hf.statuses = [completed("https://cdn.provider.test-bad/out.mp4")];
    const r = await requestGeneration(await input());
    await dispatchJob(r.job.id);
    let job = null;
    for (let i = 0; i < 3; i++) {
      await makeDue(r.job.id);
      job = await refreshJob(r.job.id);
    }
    expect(job).toMatchObject({ status: "FAILED", error_code: "RESULT_UNAVAILABLE" });
    expect(hf.getCalls).toBe(1); // finalize retries re-download, they don't re-poll or resubmit
  });

  it("regenerate reuses the previous photo and links the jobs", async () => {
    await readyReference();
    const first = await requestGeneration(await input());
    await h.db.query("update generation_jobs set status = 'COMPLETED' where id = $1", [first.job.id]);
    const again = await requestGeneration({ ...(await input()), uploadId: null, regenerateOf: first.job.id });
    expect(again.job.regenerate_of).toBe(first.job.id);
    expect(again.job.upload_id).toBe(first.job.upload_id);
  });
});

describe("cost controls", () => {
  it("enforces per-device concurrency and hourly limits", async () => {
    await readyReference();
    const a = await requestGeneration(await input());
    const b = await requestGeneration(await input());
    await dispatchJob(a.job.id);
    await dispatchJob(b.job.id);
    await expect(requestGeneration(await input())).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    await h.db.query("update generation_jobs set status = 'COMPLETED'");
    const c = await requestGeneration(await input());
    await dispatchJob(c.job.id);
    await h.db.query("update generation_jobs set status = 'COMPLETED'");
    await expect(requestGeneration(await input())).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("blocked (not-ready) requests don't consume limits", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await requestGeneration(await input());
      expect(r.job.error_code).toBe("REFERENCE_MOTION_NOT_READY");
    }
  });
});

describe("reference approval, retention and deletion", () => {
  it("requires every suitability check and creates a new template version", async () => {
    const ref = await registerReferenceAsset(h.db, makeMp4(), {
      templateId: "tpl_rubber_legs",
      creator: "x y",
      owner: "TM",
      creationMethod: "IN_HOUSE_CAPTURE",
      license: "owned",
      permissionEvidence: "release",
      capturedOn: null,
      notes: "",
    });
    await expect(approveReferenceAsset(h.db, ref.id, "rev", { single_performer: true })).rejects.toThrow(
      /suitability/,
    );
    const r = await approveReferenceAsset(h.db, ref.id, "rev", ALL_CHECKS);
    expect(r.templateVersion).toBe(2);
    const [concept] = await h.db.query<{ status: string }>(
      "select status from dance_concepts where template_id = 'tpl_rubber_legs'",
    );
    expect(concept!.status).toBe("REFERENCE_READY");
  });

  it("pins the exact template version on each job", async () => {
    await readyReference();
    const r = await requestGeneration(await input());
    expect(r.job.template_version).toBe(2);
    const [v] = await h.db.query<{ reference_motion_asset_id: string }>(
      "select reference_motion_asset_id from template_versions where id = $1",
      [r.job.template_version_id],
    );
    expect(v!.reference_motion_asset_id).toBeTruthy();
  });

  it("deletes expired photos but not ones in use", async () => {
    const up = await saveSourcePhoto(h.db, OWNER, figurePng());
    await h.db.query("update uploads set expires_at = now() - interval '1 minute'");
    const [row] = await h.db.query<{ storage_key: string }>("select storage_key from uploads where id = $1", [
      up.id,
    ]);
    expect(existsSync(path.join(h.storageDir, row!.storage_key))).toBe(true);
    const r = await runRetention(h.db);
    expect(r.sources).toBe(1);
    expect(existsSync(path.join(h.storageDir, row!.storage_key))).toBe(false);
  });

  it("deletes all of a device's media on request", async () => {
    await readyReference();
    hf.statuses = [completed()];
    const r = await requestGeneration(await input());
    await dispatchJob(r.job.id);
    await makeDue(r.job.id);
    const job = await refreshJob(r.job.id);
    expect(job!.status).toBe("COMPLETED");
    const summary = await deleteDeviceData(h.db, OWNER);
    expect(summary.results).toBe(1);
    expect(summary.uploads).toBeGreaterThanOrEqual(1);
    expect(existsSync(path.join(h.storageDir, job!.result_storage_key!))).toBe(false);
    const view = await jobViewFor(h.db, (await getJob(h.db, r.job.id))!);
    expect(view.result).toBeNull();
    expect(view.error?.code).toBe("RESULT_UNAVAILABLE");
  });
});
