import type { GenerationErrorCode } from "@/domain/generation";
import type { TemplateSpec } from "@/domain/template";
import type { GenerationProvider, ProviderModelInfo } from "./types";

/**
 * Model router: turns a template's provider preferences into an ordered list of
 * concrete (provider, model) candidates for this environment.
 *
 * Deliberately simple and explainable. Inputs it considers:
 *  - required capability           - template priorities + fallback provider
 *  - provider configuration        - provider health (circuit breaker)
 *  - requested quality tier        - priors for quality / latency / cost
 *  - reference asset constraints   - observed stats when there is enough data
 */

export type RejectReason =
  | "NOT_REGISTERED"
  | "NOT_CONFIGURED"
  | "MODEL_UNKNOWN"
  | "CAPABILITY_UNSUPPORTED"
  | "REFERENCE_TOO_SHORT"
  | "REFERENCE_TOO_LONG"
  | "REFERENCE_TOO_LARGE"
  | "REFERENCE_AUDIO_NOT_DROPPABLE"
  | "UNHEALTHY";

export interface ProviderHealth {
  /** Circuit open until this time (e.g. after credential or availability errors). */
  unavailableUntil?: Date | null;
  /** Observed over a recent window. Only used when n >= MIN_OBSERVATIONS. */
  n?: number;
  successRate?: number;
  p50LatencySeconds?: number;
}

export interface RouteContext {
  tier: "standard" | "pro";
  reference: { durationSeconds: number | null; bytes: number; hasAudio: boolean | null } | null;
  health?: Record<string, ProviderHealth>;
  now?: Date;
}

export interface RouteCandidate {
  providerId: string;
  model: string;
  score: number;
  isFallback: boolean;
  reasons: string[];
}

export interface RoutingDecision {
  candidates: RouteCandidate[];
  rejected: { providerId: string; model: string; reason: RejectReason }[];
  /** Set when there is no usable candidate: the precise, truthful reason. */
  blocker: Extract<
    GenerationErrorCode,
    "PROVIDER_NOT_CONFIGURED" | "REFERENCE_MOTION_NOT_READY" | "PROVIDER_FAILED"
  > | null;
}

export const MIN_OBSERVATIONS = 20;

export interface RegisteredProvider {
  provider: GenerationProvider;
  configured: boolean;
}

export function routeGeneration(
  template: Pick<TemplateSpec, "providerPreferences" | "fallbackProviderId" | "recipe">,
  providers: RegisteredProvider[],
  ctx: RouteContext,
): RoutingDecision {
  const now = ctx.now ?? new Date();
  const byId = new Map(providers.map((p) => [p.provider.id, p]));
  const candidates: RouteCandidate[] = [];
  const rejected: RoutingDecision["rejected"] = [];

  for (const pref of [...template.providerPreferences].sort((a, b) => a.priority - b.priority)) {
    const reg = byId.get(pref.providerId);
    const reject = (reason: RejectReason) =>
      rejected.push({ providerId: pref.providerId, model: pref.model, reason });
    if (!reg) {
      reject("NOT_REGISTERED");
      continue;
    }
    if (!reg.configured) {
      reject("NOT_CONFIGURED");
      continue;
    }
    const caps = reg.provider.getCapabilities();
    const model: ProviderModelInfo | undefined = caps.models.find((m) => m.id === pref.model);
    if (!model) {
      reject("MODEL_UNKNOWN");
      continue;
    }
    if (
      !caps.capabilities.includes(template.recipe.capability) ||
      model.capability !== template.recipe.capability
    ) {
      reject("CAPABILITY_UNSUPPORTED");
      continue;
    }
    if (ctx.reference) {
      const c = caps.constraints.referenceVideo;
      const d = ctx.reference.durationSeconds;
      if (d !== null && d < c.minSeconds) {
        reject("REFERENCE_TOO_SHORT");
        continue;
      }
      if (d !== null && d > c.maxSeconds) {
        reject("REFERENCE_TOO_LONG");
        continue;
      }
      if (ctx.reference.bytes > c.maxBytes) {
        reject("REFERENCE_TOO_LARGE");
        continue;
      }
      // Audio is separable from movement: never let reference audio leak into output.
      if (ctx.reference.hasAudio !== false && !caps.canDropReferenceAudio) {
        reject("REFERENCE_AUDIO_NOT_DROPPABLE");
        continue;
      }
    }
    const health = ctx.health?.[pref.providerId];
    if (health?.unavailableUntil && health.unavailableUntil > now) {
      reject("UNHEALTHY");
      continue;
    }

    const reasons: string[] = [`priority ${pref.priority}`];
    let score = 100 - pref.priority * 10;
    if (model.tier === ctx.tier) {
      score += 15;
      reasons.push(`matches ${ctx.tier} tier`);
    }
    score += model.priors.quality * 4;
    let latency = model.priors.latencySeconds;
    if (health?.n && health.n >= MIN_OBSERVATIONS) {
      if (health.p50LatencySeconds) latency = health.p50LatencySeconds;
      if (health.successRate !== undefined) {
        score += (health.successRate - 0.9) * 50;
        reasons.push(`observed success ${(health.successRate * 100).toFixed(0)}% (n=${health.n})`);
      }
    }
    score -= latency / 60;
    if (model.pricing.kind === "per_output_second" && ctx.reference?.durationSeconds) {
      score -= model.pricing.usd * ctx.reference.durationSeconds * 10;
    }
    const isFallback = template.fallbackProviderId === pref.providerId;
    if (isFallback) reasons.push("fallback provider");
    candidates.push({
      providerId: pref.providerId,
      model: pref.model,
      score: round(score),
      isFallback,
      reasons,
    });
  }

  // Fallback provider candidates always come after primary-provider candidates.
  candidates.sort((a, b) => Number(a.isFallback) - Number(b.isFallback) || b.score - a.score);

  let blocker: RoutingDecision["blocker"] = null;
  if (candidates.length === 0) {
    const reasons = new Set(rejected.map((r) => r.reason));
    const onlyConfig = [...reasons].every((r) => r === "NOT_CONFIGURED" || r === "NOT_REGISTERED");
    if (onlyConfig) blocker = "PROVIDER_NOT_CONFIGURED";
    else if ([...reasons].some((r) => r.startsWith("REFERENCE_"))) blocker = "REFERENCE_MOTION_NOT_READY";
    else blocker = "PROVIDER_FAILED";
  }
  return { candidates, rejected, blocker };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
