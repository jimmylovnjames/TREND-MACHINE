import "server-only";
import { z } from "zod";

/**
 * Server configuration, parsed once from process.env.
 * Nothing in here may ever be imported by client components (`server-only` enforces it).
 */

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_SECRET: optionalSecret,
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  TRUST_PROXY_HEADERS: bool(false),

  DATABASE_URL: optionalSecret,
  DATABASE_SSL: bool(false),
  PGLITE_DATA_DIR: z.string().default(".data/pglite"),
  ALLOW_PGLITE_IN_PRODUCTION: bool(false),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: optionalSecret,
  S3_SECRET_ACCESS_KEY: optionalSecret,
  S3_FORCE_PATH_STYLE: bool(true),

  HF_API_KEY_ID: optionalSecret,
  HF_API_KEY_SECRET: optionalSecret,
  HIGGSFIELD_API_BASE: z.string().url().default("https://api.higgsfield.ai"),
  VIGGLE_API_KEY: optionalSecret,
  VIGGLE_API_BASE: z.string().url().default("https://apis.viggle.ai"),
  GENERATION_QUALITY_TIER: z.enum(["standard", "pro"]).default("standard"),

  GENERATION_ENABLED: bool(true),
  MAX_UPLOAD_BYTES: int(10 * 1024 * 1024, 100_000, 10 * 1024 * 1024),
  GEN_LIMIT_PER_DEVICE_HOUR: int(4, 0),
  GEN_LIMIT_PER_DEVICE_DAY: int(12, 0),
  GEN_LIMIT_PER_IP_DAY: int(30, 0),
  GEN_LIMIT_GLOBAL_DAY: int(200, 0),
  MAX_ACTIVE_JOBS_PER_DEVICE: int(2, 1, 20),
  MAX_ACTIVE_JOBS_GLOBAL: int(4, 1, 500),
  DAILY_BUDGET_USD: z.coerce.number().min(0).optional(),
  UPLOAD_LIMIT_PER_DEVICE_HOUR: int(30, 1),
  PROVIDER_REQUEST_TIMEOUT_MS: int(30_000, 1000, 120_000),
  MAX_RESULT_BYTES: int(200 * 1024 * 1024, 1024 * 1024),

  SOURCE_RETENTION_HOURS: int(24, 1, 24 * 30),
  RESULT_RETENTION_DAYS: int(30, 1, 3650),

  ADMIN_TOKEN: optionalSecret,
  CRON_SECRET: optionalSecret,
  TREND_INGEST_TOKEN: optionalSecret,
});

export type AppConfig = z.infer<typeof envSchema> & { appSecret: string; isProduction: boolean };

let cached: AppConfig | undefined;

const DEV_SECRET = "trend-machine-insecure-development-secret-do-not-use-in-production";

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report field names only — never values, which may be secrets.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";
  if (isProduction && (!env.APP_SECRET || env.APP_SECRET.length < 32)) {
    throw new Error("APP_SECRET must be set to at least 32 characters in production");
  }
  if (env.APP_SECRET && env.APP_SECRET.length < 32) {
    throw new Error("APP_SECRET must be at least 32 characters");
  }
  if (isProduction && !env.DATABASE_URL && !env.ALLOW_PGLITE_IN_PRODUCTION) {
    throw new Error("DATABASE_URL is required in production (or set ALLOW_PGLITE_IN_PRODUCTION=true)");
  }
  if (env.STORAGE_DRIVER === "s3") {
    const missing = (
      ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const
    ).filter((k) => !env[k]);
    if (missing.length) throw new Error(`STORAGE_DRIVER=s3 requires ${missing.join(", ")}`);
  }
  cached = { ...env, appSecret: env.APP_SECRET ?? DEV_SECRET, isProduction };
  return cached;
}

/** Test hook. */
export function resetConfigForTests(): void {
  cached = undefined;
}

export function adminEnabled(cfg: AppConfig = getConfig()): boolean {
  return !!cfg.ADMIN_TOKEN && cfg.ADMIN_TOKEN.length >= 32;
}
