import "server-only";

export class BodyTooLargeError extends Error {}

/** Read a request body with a hard byte cap (never trusts Content-Length alone). */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export async function readJsonCapped(req: Request, maxBytes = 16_384): Promise<unknown> {
  const bytes = await readBodyCapped(req, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
