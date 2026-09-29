import { isRecord, providerFetch, readJson, str } from "./http";
import {
  ProviderError,
  type GenerationProvider,
  type GenerationRequest,
  type MediaInput,
  type ProviderCapabilities,
  type ProviderJobState,
  type ProviderJobStatus,
  type ProviderSubmission,
} from "./types";

/**
 * Higgsfield API adapter — Kling Motion Control (image + reference video → video).
 *
 * Verified against https://docs.higgsfield.ai (2026-09):
 *   POST {base}/kling-video/v3/motion-control/{std|pro}   (Kling 3.0)
 *   POST {base}/kling-video/motion-control/{std|pro}      (Kling 2.6)
 *     body: { image_url, video_url, prompt?, keep_original_sound: "yes"|"no", character_orientation: "image"|"video" }
 *   GET  {base}/requests/{request_id}/status  → queued | in_progress | completed | failed | nsfw | canceled
 *   POST {base}/requests/{request_id}/cancel  (only while queued)
 *   POST {base}/files/generate-upload-url { content_type } → { public_url, upload_url, upload_headers }
 *   POST {base}/estimate/{model} → { credits, usd }
 *   Auth: "Authorization: Key {key_id}:{key_secret}"
 *
 * Inputs must be URLs reachable by Higgsfield. We upload through Higgsfield's own
 * presigned-upload flow (tagged `retention=temporary` by Higgsfield) so our own
 * storage never has to be public.
 */

export const HIGGSFIELD_MODELS = [
  "kling-video/v3/motion-control/std",
  "kling-video/v3/motion-control/pro",
  "kling-video/motion-control/std",
  "kling-video/motion-control/pro",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HiggsfieldOptions {
  keyId?: string;
  keySecret?: string;
  baseUrl: string;
  timeoutMs: number;
}

export class HiggsfieldProvider implements GenerationProvider {
  readonly id = "higgsfield";
  readonly label = "Higgsfield · Kling Motion Control";

  constructor(private readonly opts: HiggsfieldOptions) {}

  async isConfigured(): Promise<boolean> {
    return !!(this.opts.keyId && this.opts.keySecret);
  }

  getCapabilities(): ProviderCapabilities {
    const priors = {
      "kling-video/v3/motion-control/std": {
        quality: 4,
        latencySeconds: 240,
        tier: "standard" as const,
        label: "Kling 3.0 Motion Control · Standard",
      },
      "kling-video/v3/motion-control/pro": {
        quality: 5,
        latencySeconds: 420,
        tier: "pro" as const,
        label: "Kling 3.0 Motion Control · Pro",
      },
      "kling-video/motion-control/std": {
        quality: 3,
        latencySeconds: 240,
        tier: "standard" as const,
        label: "Kling 2.6 Motion Control · Standard",
      },
      "kling-video/motion-control/pro": {
        quality: 4,
        latencySeconds: 420,
        tier: "pro" as const,
        label: "Kling 2.6 Motion Control · Pro",
      },
    };
    return {
      capabilities: ["HUMAN_MOTION_TRANSFER"],
      models: HIGGSFIELD_MODELS.map((id) => ({
        id,
        label: priors[id].label,
        capability: "HUMAN_MOTION_TRANSFER" as const,
        tier: priors[id].tier,
        priors: { quality: priors[id].quality, latencySeconds: priors[id].latencySeconds },
        pricing: { kind: "provider_estimate_endpoint" as const },
      })),
      constraints: {
        image: {
          maxBytes: 10 * 1024 * 1024,
          minDimension: 300,
          contentTypes: ["image/jpeg", "image/png", "image/webp"],
        },
        referenceVideo: {
          minSeconds: 3,
          maxSeconds: 30,
          maxBytes: 100 * 1024 * 1024,
          contentTypes: ["video/mp4"],
        },
      },
      supportsCancel: true,
      supportsWebhook: true,
      canDropReferenceAudio: true,
    };
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    if (!this.opts.keyId || !this.opts.keySecret) {
      throw new ProviderError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "Higgsfield credentials missing",
        providerUnavailable: true,
      });
    }
    return { Authorization: `Key ${this.opts.keyId}:${this.opts.keySecret}`, ...extra };
  }

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, "")}/${path}`;
  }

  async createJob(req: GenerationRequest): Promise<ProviderSubmission> {
    if (!(HIGGSFIELD_MODELS as readonly string[]).includes(req.model)) {
      throw new ProviderError({ code: "INTERNAL_ERROR", message: `unknown Higgsfield model ${req.model}` });
    }
    const imageUrl = await this.uploadInput(req.image);
    const videoUrl = await this.uploadInput(req.referenceVideo);
    const body = {
      image_url: imageUrl,
      video_url: videoUrl,
      prompt: req.prompt,
      keep_original_sound: "no",
      character_orientation: req.characterOrientation,
    };

    const cost = await this.estimate(req.model, body);

    const submitUrl = new URL(this.url(req.model));
    if (req.webhookUrl) submitUrl.searchParams.set("hf_webhook", req.webhookUrl);
    const res = await providerFetch(submitUrl.toString(), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      timeoutMs: this.opts.timeoutMs,
      submission: true,
    });
    const json = await readJson(res);
    if (!res.ok) throw httpError(res.status, json, true);
    const requestId = isRecord(json) ? str(json.request_id) : undefined;
    if (!requestId || !UUID_RE.test(requestId)) {
      // The provider answered 2xx but we can't track the job: treat as ambiguous.
      throw new ProviderError({
        code: "PROVIDER_FAILED",
        message: "submission response missing request_id",
        accepted: "UNKNOWN",
      });
    }
    return {
      providerJobId: requestId,
      state: mapStatus(str((json as Record<string, unknown>).status) ?? "queued"),
      cost,
    };
  }

  async getJob(providerJobId: string): Promise<ProviderJobStatus> {
    if (!UUID_RE.test(providerJobId))
      throw new ProviderError({ code: "INTERNAL_ERROR", message: "bad request id" });
    const res = await providerFetch(this.url(`requests/${providerJobId}/status`), {
      headers: this.headers(),
      timeoutMs: this.opts.timeoutMs,
    });
    const json = await readJson(res);
    if (!res.ok) throw httpError(res.status, json, false);
    if (!isRecord(json))
      throw new ProviderError({ code: "PROVIDER_FAILED", message: "bad status body", retryable: true });
    const raw = str(json.status) ?? "unknown";
    const state = mapStatus(raw);
    const video = isRecord(json.video) ? str(json.video.url) : undefined;
    let error: ProviderError | null = null;
    if (raw === "nsfw") {
      error = new ProviderError({
        code: "PROVIDER_REJECTED",
        message: "content moderation rejected input/output",
        providerCode: "nsfw",
      });
    } else if (raw === "failed") {
      error = new ProviderError({
        code: "PROVIDER_FAILED",
        message: `generation failed: ${str(json.error) ?? "no detail"}`,
        providerCode: "failed",
      });
    }
    if (state === "COMPLETED" && !video) {
      error = new ProviderError({ code: "PROVIDER_FAILED", message: "completed without video url" });
      return { state: "FAILED", rawStatus: raw, progress: null, outputUrl: null, error };
    }
    return { state, rawStatus: raw, progress: null, outputUrl: video ?? null, error };
  }

  async cancelJob(providerJobId: string): Promise<void> {
    if (!UUID_RE.test(providerJobId)) return;
    const res = await providerFetch(this.url(`requests/${providerJobId}/cancel`), {
      method: "POST",
      headers: this.headers(),
      timeoutMs: this.opts.timeoutMs,
    });
    // 400 = already processing (not cancelable). Nothing else to do.
    if (!res.ok && res.status !== 400) throw httpError(res.status, await readJson(res), false);
  }

  webhookJobId(body: unknown): string | null {
    if (!isRecord(body)) return null;
    const id = str(body.request_id);
    return id && UUID_RE.test(id) ? id : null;
  }

  private async uploadInput(media: MediaInput): Promise<string> {
    const res = await providerFetch(this.url("files/generate-upload-url"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ content_type: media.contentType }),
      timeoutMs: this.opts.timeoutMs,
    });
    const json = await readJson(res);
    if (!res.ok) throw httpError(res.status, json, false);
    if (!isRecord(json))
      throw new ProviderError({ code: "PROVIDER_FAILED", message: "bad upload-url body", retryable: true });
    const uploadUrl = str(json.upload_url);
    const publicUrl = str(json.public_url);
    const headers = isRecord(json.upload_headers) ? json.upload_headers : {};
    if (!uploadUrl || !publicUrl)
      throw new ProviderError({
        code: "PROVIDER_FAILED",
        message: "upload-url missing fields",
        retryable: true,
      });
    const putHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) if (typeof v === "string") putHeaders[k] = v;
    // Never send Higgsfield credentials to the presigned storage URL.
    const put = await providerFetch(uploadUrl, {
      method: "PUT",
      headers: putHeaders,
      body: media.data as BodyInit,
      timeoutMs: Math.max(this.opts.timeoutMs, 60_000),
    });
    if (!put.ok) {
      throw new ProviderError({
        code: "PROVIDER_FAILED",
        message: `input upload failed (${put.status})`,
        retryable: true,
        httpStatus: put.status,
      });
    }
    return publicUrl;
  }

  private async estimate(model: string, body: unknown): Promise<ProviderSubmission["cost"]> {
    try {
      const res = await providerFetch(this.url(`estimate/${model}`), {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        timeoutMs: 10_000,
      });
      if (!res.ok) return null;
      const json = await readJson(res);
      const usd = isRecord(json) ? Number(json.usd) : NaN;
      return Number.isFinite(usd) && usd >= 0 ? { usd, source: "PROVIDER_ESTIMATE" } : null;
    } catch {
      return null; // Cost estimate is best-effort and never blocks generation.
    }
  }
}

export function mapStatus(raw: string): ProviderJobState {
  switch (raw) {
    case "queued":
      return "QUEUED";
    case "in_progress":
      return "PROCESSING";
    case "completed":
      return "COMPLETED";
    case "failed":
    case "nsfw":
      return "FAILED";
    case "canceled":
      return "CANCELED";
    default:
      return "PROCESSING"; // Unknown non-terminal value: keep polling until our deadline.
  }
}

/** Map Higgsfield HTTP errors (documented table) onto our vocabulary. */
export function httpError(status: number, body: unknown, submission: boolean): ProviderError {
  const detail = isRecord(body) ? body.detail : undefined;
  const text = typeof detail === "string" ? detail : JSON.stringify(detail ?? "").slice(0, 300);
  const base = { httpStatus: status, message: `higgsfield ${status}: ${text}` };
  if (status === 401)
    return new ProviderError({ ...base, code: "PROVIDER_NOT_CONFIGURED", providerUnavailable: true });
  if (status === 403)
    return new ProviderError({
      ...base,
      code: "PROVIDER_FAILED",
      providerCode: "insufficient_credits",
      providerUnavailable: true,
    });
  if (status === 400 && /concurren/i.test(text)) {
    return new ProviderError({
      ...base,
      code: "PROVIDER_FAILED",
      providerCode: "concurrency",
      retryable: true,
    });
  }
  if (status === 400) return new ProviderError({ ...base, code: "PROVIDER_REJECTED" });
  if (status === 422)
    return new ProviderError({ ...base, code: "PROVIDER_FAILED", providerCode: "validation" });
  if (status === 404)
    return new ProviderError({
      ...base,
      code: "PROVIDER_FAILED",
      providerCode: "not_found",
      providerUnavailable: submission,
    });
  if (status === 423 || status === 503) {
    return new ProviderError({
      ...base,
      code: "PROVIDER_FAILED",
      providerCode: "model_unavailable",
      retryable: true,
      providerUnavailable: true,
    });
  }
  if (status === 429)
    return new ProviderError({
      ...base,
      code: "PROVIDER_FAILED",
      providerCode: "rate_limited",
      retryable: true,
    });
  if (status >= 500) {
    // A 5xx on submission is a response, so the job was most likely not accepted — but
    // Higgsfield offers no idempotency key, so we still treat it as ambiguous.
    return new ProviderError({
      ...base,
      code: "PROVIDER_FAILED",
      retryable: !submission,
      accepted: submission ? "UNKNOWN" : "NO",
    });
  }
  return new ProviderError({ ...base, code: "PROVIDER_FAILED" });
}
