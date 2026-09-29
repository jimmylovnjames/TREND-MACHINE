import { AwsClient } from "aws4fetch";
import { assertValidKey, contentTypeForKey, type SignedUrlOptions, type StorageDriver } from "./types";

/**
 * S3-compatible private bucket (AWS S3, Cloudflare R2, Supabase Storage S3, MinIO).
 * The bucket must NOT allow public reads; all access is via short-lived presigned URLs.
 */
export class S3Storage implements StorageDriver {
  readonly kind = "s3" as const;
  private readonly client: AwsClient;

  constructor(
    private readonly opts: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    },
  ) {
    this.client = new AwsClient({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      region: opts.region,
      service: "s3",
    });
  }

  private url(key: string): string {
    assertValidKey(key);
    const base = new URL(this.opts.endpoint);
    if (this.opts.forcePathStyle) {
      base.pathname = `${base.pathname.replace(/\/$/, "")}/${this.opts.bucket}/${key}`;
    } else {
      base.hostname = `${this.opts.bucket}.${base.hostname}`;
      base.pathname = `/${key}`;
    }
    return base.toString();
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), {
      method: "PUT",
      body: data as BodyInit,
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=0" },
    });
    if (!res.ok) throw new Error(`Storage PUT failed (${res.status})`);
  }

  async read(key: string, maxBytes: number) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage GET failed (${res.status})`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > maxBytes) throw new Error("Object exceeds read limit");
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength > maxBytes) throw new Error("Object exceeds read limit");
    return { data, contentType: res.headers.get("content-type") ?? contentTypeForKey(key) };
  }

  async stream(key: string, range?: { start: number; end?: number }) {
    const headers: Record<string, string> = {};
    if (range) headers.Range = `bytes=${range.start}-${range.end ?? ""}`;
    const res = await this.client.fetch(this.url(key), { headers });
    if (res.status === 404) return null;
    if (!res.ok || !res.body) throw new Error(`Storage GET failed (${res.status})`);
    const cr = res.headers.get("content-range");
    const m = cr?.match(/bytes (\d+)-(\d+)\/(\d+)/);
    return {
      body: res.body,
      size: m ? Number(m[3]) : Number(res.headers.get("content-length") ?? 0),
      contentType: res.headers.get("content-type") ?? contentTypeForKey(key),
      range: m ? { start: Number(m[1]), end: Number(m[2]) } : undefined,
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Storage DELETE failed (${res.status})`);
  }

  async signedUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    const u = new URL(this.url(key));
    u.searchParams.set("X-Amz-Expires", String(opts.ttlSeconds));
    if (opts.downloadName) {
      u.searchParams.set("response-content-disposition", `attachment; filename="${opts.downloadName}"`);
    }
    const signed = await this.client.sign(u.toString(), { method: "GET", aws: { signQuery: true } });
    return signed.url;
  }
}
