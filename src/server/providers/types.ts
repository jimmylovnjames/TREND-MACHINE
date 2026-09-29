import type { GenerationErrorCode } from "@/domain/generation";
import type { Capability } from "@/domain/template";

/**
 * The generation-provider contract. The rest of the application only talks to
 * providers through this interface (via the router + generation service) — never to
 * vendor APIs directly.
 */

export type ProviderJobState = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELED";

export interface ProviderModelInfo {
  /** Provider-specific model / endpoint id, e.g. "kling-video/v3/motion-control/std". */
  id: string;
  label: string;
  capability: Capability;
  tier: "preview" | "standard" | "pro";
  /**
   * Operator-configured priors used by the router until enough observed data exists.
   * These are NOT vendor claims; see provider_reliability view for measured values.
   */
  priors: { quality: number; latencySeconds: number };
  pricing:
    | { kind: "per_output_second"; usd: number; source: string }
    | { kind: "provider_estimate_endpoint" }
    | { kind: "unknown" };
}

export interface ProviderConstraints {
  image: { maxBytes: number; minDimension: number; contentTypes: string[] };
  referenceVideo: { minSeconds: number; maxSeconds: number; maxBytes: number; contentTypes: string[] };
}

export interface ProviderCapabilities {
  capabilities: Capability[];
  models: ProviderModelInfo[];
  constraints: ProviderConstraints;
  supportsCancel: boolean;
  supportsWebhook: boolean;
  /** Whether the provider lets us drop the reference video's audio track. */
  canDropReferenceAudio: boolean;
}

export interface MediaInput {
  data: Uint8Array;
  contentType: string;
  filename: string;
}

export interface GenerationRequest {
  jobId: string;
  model: string;
  capability: Capability;
  image: MediaInput;
  referenceVideo: MediaInput & { durationSeconds: number | null };
  prompt: string;
  characterOrientation: "video" | "image";
  keepReferenceAudio: false;
  /** Public HTTPS callback URL, if the deployment is publicly reachable. */
  webhookUrl?: string;
  config: Record<string, string | number | boolean>;
}

export interface CostEstimate {
  usd: number;
  source: "PROVIDER_ESTIMATE" | "PRICE_TABLE" | "PROVIDER_REPORTED";
}

export interface ProviderSubmission {
  providerJobId: string;
  state: ProviderJobState;
  cost: CostEstimate | null;
}

export interface ProviderJobStatus {
  state: ProviderJobState;
  /** Raw vendor status string, stored for debugging. */
  rawStatus: string;
  progress: number | null;
  outputUrl: string | null;
  error: ProviderError | null;
}

export interface GenerationProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): Promise<boolean>;
  getCapabilities(): ProviderCapabilities;
  createJob(request: GenerationRequest): Promise<ProviderSubmission>;
  getJob(providerJobId: string): Promise<ProviderJobStatus>;
  cancelJob?(providerJobId: string): Promise<void>;
  /** Extract the provider job id from an (untrusted) webhook body. Status is always re-fetched. */
  webhookJobId?(body: unknown): string | null;
}

/**
 * Normalized provider failure.
 * `accepted` records whether the provider might have accepted (and billed) the work:
 * - "NO": definitely not accepted — safe to try again / fall back.
 * - "UNKNOWN": ambiguous (e.g. network timeout after sending) — NEVER auto-resubmit.
 */
export class ProviderError extends Error {
  readonly code: GenerationErrorCode;
  readonly retryable: boolean;
  readonly accepted: "NO" | "UNKNOWN";
  readonly httpStatus?: number;
  readonly providerCode?: string;
  /** Marks the provider itself as unusable right now (bad credentials, disabled model). */
  readonly providerUnavailable: boolean;

  constructor(opts: {
    code: GenerationErrorCode;
    message: string;
    retryable?: boolean;
    accepted?: "NO" | "UNKNOWN";
    httpStatus?: number;
    providerCode?: string;
    providerUnavailable?: boolean;
  }) {
    super(opts.message);
    this.name = "ProviderError";
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.accepted = opts.accepted ?? "NO";
    this.httpStatus = opts.httpStatus;
    this.providerCode = opts.providerCode;
    this.providerUnavailable = opts.providerUnavailable ?? false;
  }
}
