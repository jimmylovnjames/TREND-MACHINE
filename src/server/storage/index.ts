import "server-only";
import path from "node:path";
import { getConfig } from "../config";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { StorageDriver } from "./types";

export * from "./types";

type G = typeof globalThis & { __tmStorage?: StorageDriver };
const g = globalThis as G;

export function getStorage(): StorageDriver {
  if (g.__tmStorage) return g.__tmStorage;
  const cfg = getConfig();
  g.__tmStorage =
    cfg.STORAGE_DRIVER === "s3"
      ? new S3Storage({
          endpoint: cfg.S3_ENDPOINT!,
          region: cfg.S3_REGION,
          bucket: cfg.S3_BUCKET!,
          accessKeyId: cfg.S3_ACCESS_KEY_ID!,
          secretAccessKey: cfg.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
        })
      : new LocalStorage(
          path.resolve(/*turbopackIgnore: true*/ process.cwd(), cfg.LOCAL_STORAGE_DIR),
          cfg.appSecret,
        );
  return g.__tmStorage;
}

export function setStorageForTests(s: StorageDriver | undefined): void {
  g.__tmStorage = s;
}
