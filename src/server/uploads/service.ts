import "server-only";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config";
import type { Db } from "../db";
import { hitRateLimit } from "../ratelimit";
import { sha256Hex } from "../security/crypto";
import { getStorage, newKey } from "../storage";
import { processImage } from "./image";

export class UploadRateLimitedError extends Error {}

export interface UploadResult {
  id: string;
  width: number;
  height: number;
  bytes: number;
  expiresAt: string;
}

/**
 * Store a validated, metadata-stripped source photo in private storage.
 * Source photos expire after SOURCE_RETENTION_HOURS and are deleted by cleanup.
 */
export async function saveSourcePhoto(db: Db, ownerHash: string, raw: Uint8Array): Promise<UploadResult> {
  const cfg = getConfig();
  if (!(await hitRateLimit(db, `upload:${ownerHash}`, 3600, cfg.UPLOAD_LIMIT_PER_DEVICE_HOUR))) {
    throw new UploadRateLimitedError("upload rate limit");
  }
  const img = processImage(raw, cfg.MAX_UPLOAD_BYTES);
  const id = randomUUID();
  const key = newKey("sources", id.replace(/-/g, ""), img.contentType);
  await getStorage().put(key, img.data, img.contentType);
  const expiresAt = new Date(Date.now() + cfg.SOURCE_RETENTION_HOURS * 3600_000);
  try {
    await db.query(
      `insert into uploads (id, owner_hash, storage_key, content_type, bytes, width, height, sha256, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        ownerHash,
        key,
        img.contentType,
        img.data.byteLength,
        img.width,
        img.height,
        sha256Hex(img.data),
        expiresAt,
      ],
    );
  } catch (e) {
    await getStorage()
      .delete(key)
      .catch(() => undefined);
    throw e;
  }
  return {
    id,
    width: img.width,
    height: img.height,
    bytes: img.data.byteLength,
    expiresAt: expiresAt.toISOString(),
  };
}
