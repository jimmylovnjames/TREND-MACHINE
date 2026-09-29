import { ProviderError } from "./types";

export interface ProviderFetchOptions extends RequestInit {
  timeoutMs: number;
  /** Is this request a job submission (non-idempotent, may bill)? */
  submission?: boolean;
  maxResponseBytes?: number;
}

/**
 * fetch with timeout + normalized network errors. For submissions, a network error or
 * timeout is AMBIGUOUS: the provider may have accepted the job, so it must never be
 * retried automatically.
 */
export async function providerFetch(url: string, opts: ProviderFetchOptions): Promise<Response> {
  const { timeoutMs, submission, maxResponseBytes: _max, ...init } = opts;
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ProviderError({
      code: timeout ? "TIMEOUT" : "PROVIDER_FAILED",
      message: `network error${timeout ? " (timeout)" : ""}: ${e instanceof Error ? e.message : String(e)}`,
      retryable: !submission,
      accepted: submission ? "UNKNOWN" : "NO",
    });
  }
}

export async function readJson(res: Response, maxBytes = 1_000_000): Promise<unknown> {
  const text = await res.text();
  if (text.length > maxBytes) throw new Error("provider response too large");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _nonJson: text.slice(0, 200) };
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Only allow provider output downloads over HTTPS from non-literal hosts. */
export function isSafeOutputUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    const h = url.hostname;
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local"))
      return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}
