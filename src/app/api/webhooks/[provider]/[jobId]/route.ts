import { NextResponse } from "next/server";
import { readJsonCapped } from "@/server/body";
import { handleWebhook } from "@/server/generation/service";
import { logError } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Provider completion callbacks. Authenticated by a per-job HMAC capability token in
 * the URL. The body is treated as an untrusted hint: status is re-fetched from the
 * provider's authenticated API before anything changes.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string; jobId: string }> }) {
  const { provider, jobId } = await ctx.params;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-z0-9-]{1,40}$/.test(provider) || !/^[0-9a-f-]{36}$/i.test(jobId) || !token) {
    return new NextResponse(null, { status: 404 });
  }
  let body: unknown = null;
  try {
    body = await readJsonCapped(req, 65_536);
  } catch {
    // Unparseable bodies are still a valid "go look" hint.
  }
  try {
    const ok = await handleWebhook(provider, jobId, token, body);
    // 4xx is permanent for Higgsfield (no retries) — correct for unknown/forged calls.
    return new NextResponse(null, { status: ok ? 204 : 404 });
  } catch (e) {
    logError("webhook", e, { provider });
    return new NextResponse(null, { status: 500 });
  }
}
