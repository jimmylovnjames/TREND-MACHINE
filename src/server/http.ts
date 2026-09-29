import "server-only";
import { NextResponse } from "next/server";
import { isGenerationErrorCode, userFacingError, type GenerationErrorCode } from "@/domain/generation";
import { isSameOrigin } from "./security/request";

export interface ApiErrorBody {
  error: { code: string; title: string; message: string; actions?: string[] };
}

export function apiError(status: number, code: string, message?: string, headers?: HeadersInit) {
  if (isGenerationErrorCode(code)) {
    const u = userFacingError(code);
    return NextResponse.json<ApiErrorBody>(
      { error: { code, title: u.title, message: message ?? u.message, actions: u.actions } },
      { status, headers },
    );
  }
  return NextResponse.json<ApiErrorBody>(
    { error: { code, title: "Request failed", message: message ?? "Request failed." } },
    { status, headers },
  );
}

export function generationError(status: number, code: GenerationErrorCode, headers?: HeadersInit) {
  return apiError(status, code, undefined, headers);
}

export function rejectCrossSite(req: Request) {
  return isSameOrigin(req) ? null : apiError(403, "FORBIDDEN", "Cross-site request rejected.");
}

export const noStore = { "Cache-Control": "no-store" } as const;

/** Log without leaking secrets or signed URLs. */
export function logError(scope: string, err: unknown, extra?: Record<string, unknown>) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}]`, redact(message), extra ? redactObject(extra) : "");
}

const URL_RE = /https?:\/\/[^\s"'<>]+/g;
export function redact(s: string): string {
  return s.replace(URL_RE, (u) => {
    try {
      const url = new URL(u);
      return `${url.protocol}//${url.host}${url.pathname}${url.search ? "?[redacted]" : ""}`;
    } catch {
      return "[url]";
    }
  });
}

function redactObject(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (/secret|token|key|authorization|password/i.test(k)) out[k] = "[redacted]";
    else out[k] = typeof v === "string" ? redact(v) : v;
  }
  return out;
}
