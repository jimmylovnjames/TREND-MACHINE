import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { hmacB64, safeEqual } from "../security/crypto";
import { assertValidKey, contentTypeForKey, type SignedUrlOptions, type StorageDriver } from "./types";

/**
 * Private local-disk storage. Files are never served statically; access goes through
 * /api/media with an expiring HMAC signature.
 */
export class LocalStorage implements StorageDriver {
  readonly kind = "local" as const;
  constructor(
    private readonly root: string,
    private readonly secret: string,
  ) {}

  private file(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage path");
    return full;
  }

  async put(key: string, data: Uint8Array, _contentType: string): Promise<void> {
    const full = this.file(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, full);
  }

  async read(key: string, maxBytes: number) {
    const full = this.file(key);
    try {
      const s = await stat(full);
      if (s.size > maxBytes) throw new Error("Object exceeds read limit");
      return { data: new Uint8Array(await readFile(full)), contentType: contentTypeForKey(key) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async stream(key: string, range?: { start: number; end?: number }) {
    const full = this.file(key);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const contentType = contentTypeForKey(key);
    if (range) {
      const start = Math.min(range.start, Math.max(size - 1, 0));
      const end = Math.min(range.end ?? size - 1, size - 1);
      const body = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream<Uint8Array>;
      return { body, size, contentType, range: { start, end } };
    }
    return { body: Readable.toWeb(createReadStream(full)) as ReadableStream<Uint8Array>, size, contentType };
  }

  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }

  async signedUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    assertValidKey(key);
    const exp = Math.floor(Date.now() / 1000) + opts.ttlSeconds;
    const dl = opts.downloadName ?? "";
    const sig = signLocal(this.secret, key, exp, dl);
    const qs = new URLSearchParams({ exp: String(exp), sig });
    if (dl) qs.set("dl", dl);
    return `/api/media/${key}?${qs.toString()}`;
  }
}

export function signLocal(secret: string, key: string, exp: number, dl: string): string {
  return hmacB64(secret, "media", `${key}\n${exp}\n${dl}`);
}

export function verifyLocalSignature(
  secret: string,
  key: string,
  exp: string | null,
  sig: string | null,
  dl: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) < nowSeconds) return false;
  return safeEqual(signLocal(secret, key, Number(exp), dl ?? ""), sig);
}
