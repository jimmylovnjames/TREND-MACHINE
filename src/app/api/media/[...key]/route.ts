import { getConfig } from "@/server/config";
import { getStorage, STORAGE_KEY_RE } from "@/server/storage";
import { verifyLocalSignature } from "@/server/storage/local";

export const dynamic = "force-dynamic";

/**
 * Serves private local-storage objects behind short-lived HMAC-signed URLs.
 * Supports HTTP Range (required for video playback on iOS Safari).
 * Source photos are never served here — only results, reference and preview media.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const cfg = getConfig();
  const storage = getStorage();
  if (storage.kind !== "local") return new Response("Not found", { status: 404 });
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  if (!STORAGE_KEY_RE.test(key) || key.startsWith("sources/"))
    return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const dl = url.searchParams.get("dl");
  if (
    !verifyLocalSignature(cfg.appSecret, key, url.searchParams.get("exp"), url.searchParams.get("sig"), dl)
  ) {
    return new Response("Link expired", { status: 403 });
  }
  let range: { start: number; end?: number } | undefined;
  const rh = req.headers.get("range");
  if (rh) {
    const m = rh.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (!m[1] && !m[2])) return new Response("Bad range", { status: 416 });
    if (m[1]) range = { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined };
    else range = { start: -Number(m[2]) }; // suffix range, resolved below
  }
  let obj;
  if (range && range.start < 0) {
    const head = await storage.stream(key);
    if (!head) return new Response("Not found", { status: 404 });
    await head.body.cancel();
    const start = Math.max(0, head.size + range.start);
    obj = await storage.stream(key, { start });
  } else {
    obj = await storage.stream(key, range);
  }
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": obj.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  if (dl && /^[a-z0-9._-]{1,100}$/i.test(dl))
    headers.set("Content-Disposition", `attachment; filename="${dl}"`);
  if (obj.range) {
    if (obj.range.start >= obj.size)
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${obj.size}` },
      });
    headers.set("Content-Range", `bytes ${obj.range.start}-${obj.range.end}/${obj.size}`);
    headers.set("Content-Length", String(obj.range.end - obj.range.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
