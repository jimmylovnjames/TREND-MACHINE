import { isRecord, providerFetch, readJson, str } from "./http";
import {
  ProviderError,
  type GenerationProvider,
  type GenerationRequest,
  type ProviderCapabilities,
  type ProviderJobState,
  type ProviderJobStatus,
  type ProviderSubmission,
} from "./types";

/**
 * Viggle API V1 adapter — character image + driving video → video ("Mix").
 *
 * Verified against https://docs.viggle.ai (2026-09):
 *   POST {base}/v1/renders  multipart/form-data: image (file), motion_video (file),
 *        background_mode=original, model? (V3|V4|...)   → 200 { id: "render_…", status }
 *   GET  {base}/v1/videos/{id} → { status: queued|processing|ready|failed|cancelled, progress, video_url, error }
 *   Errors: { error: { code, message, retryable, request_id } }
 *   Auth: "Authorization: Bearer {VIGGLE_API_KEY}"
 *   Price: $0.01 per finished second per character (documented).
 *
 * Direct multipart upload means inputs never need a public URL. Viggle has no
 * client-side cancel and no documented way to drop reference audio, so the router only
 * uses it with silent reference assets.
 */

export const VIGGLE_MODEL = "viggle/v1/render";
const VIGGLE_USD_PER_SECOND = 0.01;
const ID_RE = /^render_[A-Za-z0-9_-]{1,100}$/;
const ALLOWED_RENDER_MODELS = new Set(["V3", "V4", "V3_Preview", "V4_Preview", "V4_BaseSG"]);

export interface ViggleOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
}

export class ViggleProvider implements GenerationProvider {
  readonly id = "viggle";
  readonly label = "Viggle · Mix";

  constructor(private readonly opts: ViggleOptions) {}

  async isConfigured(): Promise<boolean> {
    return !!this.opts.apiKey;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      capabilities: ["HUMAN_MOTION_TRANSFER", "CHARACTER_ANIMATION"],
      models: [
        {
          id: VIGGLE_MODEL,
          label: "Viggle V1 Render",
          capability: "HUMAN_MOTION_TRANSFER",
          tier: "standard",
          priors: { quality: 3, latencySeconds: 180 },
          pricing: {
            kind: "per_output_second",
            usd: VIGGLE_USD_PER_SECOND,
            source: "docs.viggle.ai/v1/pricing",
          },
        },
      ],
      constraints: {
        image: {
          maxBytes: 10 * 1024 * 1024,
          minDimension: 300,
          contentTypes: ["image/jpeg", "image/png", "image/webp"],
        },
        referenceVideo: {
          minSeconds: 2,
          maxSeconds: 30,
          maxBytes: 100 * 1024 * 1024,
          contentTypes: ["video/mp4"],
        },
      },
      supportsCancel: false,
      supportsWebhook: false,
      canDropReferenceAudio: false,
    };
  }

  private auth(): Record<string, string> {
    if (!this.opts.apiKey) {
      throw new ProviderError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "Viggle API key missing",
        providerUnavailable: true,
      });
    }
    return { Authorization: `Bearer ${this.opts.apiKey}` };
  }

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, "")}/${path}`;
  }

  async createJob(req: GenerationRequest): Promise<ProviderSubmission> {
    if (req.model !== VIGGLE_MODEL)
      throw new ProviderError({ code: "INTERNAL_ERROR", message: `unknown Viggle model ${req.model}` });
    const form = new FormData();
    form.append(
      "image",
      new Blob([req.image.data as BlobPart], { type: req.image.contentType }),
      req.image.filename,
    );
    form.append(
      "motion_video",
      new Blob([req.referenceVideo.data as BlobPart], { type: req.referenceVideo.contentType }),
      req.referenceVideo.filename,
    );
    form.append("background_mode", "original");
    const model = req.config.model;
    if (typeof model === "string" && ALLOWED_RENDER_MODELS.has(model)) form.append("model", model);

    const res = await providerFetch(this.url("v1/renders"), {
      method: "POST",
      headers: this.auth(),
      body: form,
      timeoutMs: Math.max(this.opts.timeoutMs, 90_000),
      submission: true,
    });
    const json = await readJson(res);
    if (!res.ok) throw errorFromBody(res.status, json, true);
    const id = isRecord(json) ? str(json.id) : undefined;
    if (!id || !ID_RE.test(id)) {
      throw new ProviderError({
        code: "PROVIDER_FAILED",
        message: "render response missing id",
        accepted: "UNKNOWN",
      });
    }
    const dur = req.referenceVideo.durationSeconds;
    return {
      providerJobId: id,
      state: mapStatus(str((json as Record<string, unknown>).status) ?? "queued"),
      cost: dur
        ? { usd: Math.round(dur * VIGGLE_USD_PER_SECOND * 10000) / 10000, source: "PRICE_TABLE" }
        : null,
    };
  }

  async getJob(providerJobId: string): Promise<ProviderJobStatus> {
    if (!ID_RE.test(providerJobId))
      throw new ProviderError({ code: "INTERNAL_ERROR", message: "bad render id" });
    const res = await providerFetch(this.url(`v1/videos/${providerJobId}`), {
      headers: this.auth(),
      timeoutMs: this.opts.timeoutMs,
    });
    const json = await readJson(res);
    if (!res.ok) throw errorFromBody(res.status, json, false);
    if (!isRecord(json))
      throw new ProviderError({ code: "PROVIDER_FAILED", message: "bad video body", retryable: true });
    const raw = str(json.status) ?? "unknown";
    const state = mapStatus(raw);
    const progress =
      typeof json.progress === "number" ? Math.max(0, Math.min(100, Math.round(json.progress))) : null;
    const videoUrl = str(json.video_url) ?? null;
    let error: ProviderError | null = null;
    if (state === "FAILED") error = errorFromBody(200, { error: json.error }, false);
    if (state === "COMPLETED" && !videoUrl) {
      // Docs: status==ready or video_url populated means finished. Wait for the URL.
      return { state: "PROCESSING", rawStatus: raw, progress: 99, outputUrl: null, error: null };
    }
    return { state, rawStatus: raw, progress, outputUrl: videoUrl, error };
  }
}

export function mapStatus(raw: string): ProviderJobState {
  switch (raw) {
    case "queued":
      return "QUEUED";
    case "processing":
      return "PROCESSING";
    case "ready":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELED";
    default:
      return "PROCESSING";
  }
}

const REJECT_CODES = new Set([
  "CONTENT_POLICY_VIOLATION",
  "NO_HUMANS_DETECTED",
  "INVALID_CHARACTER",
  "IMAGE_REQUIRED",
]);
const CONFIG_CODES = new Set(["UNAUTHENTICATED", "INVALID_CREDENTIAL", "FORBIDDEN"]);
const BUSY_CODES = new Set(["RATE_LIMITED", "SERVICE_BUSY", "ALL_WORKERS_BUSY", "WORKER_STOPPED"]);

export function errorFromBody(status: number, body: unknown, submission: boolean): ProviderError {
  const err = isRecord(body) && isRecord(body.error) ? body.error : {};
  const code = str(err.code) ?? `HTTP_${status}`;
  const retryable = err.retryable === true;
  const message = `viggle ${status} ${code}: ${(str(err.message) ?? "").slice(0, 200)}`;
  const base = { httpStatus: status, providerCode: code, message };
  if (CONFIG_CODES.has(code) || status === 401) {
    return new ProviderError({ ...base, code: "PROVIDER_NOT_CONFIGURED", providerUnavailable: true });
  }
  if (code === "INSUFFICIENT_CREDITS")
    return new ProviderError({ ...base, code: "PROVIDER_FAILED", providerUnavailable: true });
  if (REJECT_CODES.has(code)) return new ProviderError({ ...base, code: "PROVIDER_REJECTED" });
  if (code === "UNSUPPORTED_MEDIA") return new ProviderError({ ...base, code: "PROVIDER_REJECTED" });
  if (BUSY_CODES.has(code) || status === 429 || status === 503) {
    return new ProviderError({ ...base, code: "PROVIDER_FAILED", retryable: true });
  }
  if (status >= 500 && submission) {
    return new ProviderError({ ...base, code: "PROVIDER_FAILED", retryable: false, accepted: "UNKNOWN" });
  }
  return new ProviderError({ ...base, code: "PROVIDER_FAILED", retryable });
}
