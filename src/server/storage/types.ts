export type StoragePrefix = "sources" | "results" | "reference" | "previews";

export interface StoredObjectStream {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
  /** Present when a byte range was served. */
  range?: { start: number; end: number };
}

export interface SignedUrlOptions {
  ttlSeconds: number;
  /** When set, the URL forces a download with this filename. */
  downloadName?: string;
}

export interface StorageDriver {
  readonly kind: "local" | "s3";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  read(key: string, maxBytes: number): Promise<{ data: Uint8Array; contentType: string } | null>;
  stream(key: string, range?: { start: number; end?: number }): Promise<StoredObjectStream | null>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, opts: SignedUrlOptions): Promise<string>;
}

/** Keys are generated server-side only; this guard makes path traversal impossible. */
export const STORAGE_KEY_RE =
  /^(sources|results|reference|previews)\/[a-z0-9][a-z0-9-]{7,80}\.(jpg|png|webp|mp4)$/;

export function assertValidKey(key: string): void {
  if (!STORAGE_KEY_RE.test(key)) throw new Error("Invalid storage key");
}

export function contentTypeForKey(key: string): string {
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

export function extensionFor(contentType: string): "jpg" | "png" | "webp" | "mp4" {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    default:
      throw new Error(`Unsupported content type ${contentType}`);
  }
}

export function newKey(prefix: StoragePrefix, id: string, contentType: string): string {
  const key = `${prefix}/${id.toLowerCase()}.${extensionFor(contentType)}`;
  assertValidKey(key);
  return key;
}
