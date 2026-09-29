import type { Capability } from "@/domain/template";
import {
  ProviderError,
  type GenerationProvider,
  type GenerationRequest,
  type ProviderCapabilities,
  type ProviderJobStatus,
  type ProviderSubmission,
} from "@/server/providers/types";

/**
 * Scripted provider for TESTS ONLY. Never registered in the application.
 * `submit` / `statuses` let each test drive the provider's behaviour.
 */
export class ScriptedProvider implements GenerationProvider {
  readonly label: string;
  configured = true;
  createCalls: GenerationRequest[] = [];
  getCalls = 0;
  cancelCalls = 0;
  submit: () => Promise<ProviderSubmission> = async () => ({
    providerJobId: `job-${this.createCalls.length}`,
    state: "QUEUED",
    cost: { usd: 0.42, source: "PROVIDER_ESTIMATE" },
  });
  statuses: (() => ProviderJobStatus)[] = [];

  constructor(
    readonly id: string,
    readonly models: string[] = ["kling-video/v3/motion-control/std", "kling-video/v3/motion-control/pro"],
    private readonly opts: { canDropAudio?: boolean; capabilities?: Capability[] } = {},
  ) {
    this.label = `scripted:${id}`;
  }

  async isConfigured() {
    return this.configured;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      capabilities: this.opts.capabilities ?? ["HUMAN_MOTION_TRANSFER"],
      models: this.models.map((m, i) => ({
        id: m,
        label: m,
        capability: "HUMAN_MOTION_TRANSFER",
        tier: m.endsWith("pro") ? "pro" : "standard",
        priors: { quality: 4 - i * 0.1, latencySeconds: 200 },
        pricing: { kind: "unknown" },
      })),
      constraints: {
        image: { maxBytes: 10e6, minDimension: 300, contentTypes: ["image/png", "image/jpeg"] },
        referenceVideo: { minSeconds: 3, maxSeconds: 30, maxBytes: 100e6, contentTypes: ["video/mp4"] },
      },
      supportsCancel: true,
      supportsWebhook: false,
      canDropReferenceAudio: this.opts.canDropAudio ?? true,
    };
  }

  async createJob(req: GenerationRequest): Promise<ProviderSubmission> {
    this.createCalls.push(req);
    return this.submit();
  }

  async getJob(): Promise<ProviderJobStatus> {
    this.getCalls++;
    const next = this.statuses.shift();
    if (!next)
      return { state: "PROCESSING", rawStatus: "in_progress", progress: null, outputUrl: null, error: null };
    return next();
  }

  async cancelJob() {
    this.cancelCalls++;
  }
}

export const completed =
  (url = "https://cdn.provider.test/out.mp4"): (() => ProviderJobStatus) =>
  () => ({
    state: "COMPLETED",
    rawStatus: "completed",
    progress: 100,
    outputUrl: url,
    error: null,
  });

export const failed =
  (err: ProviderError): (() => ProviderJobStatus) =>
  () => ({
    state: "FAILED",
    rawStatus: "failed",
    progress: null,
    outputUrl: null,
    error: err,
  });
