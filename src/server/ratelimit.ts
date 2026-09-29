import "server-only";
import type { Queryable } from "./db";

/**
 * Fixed-window counter stored in Postgres, so limits hold across instances.
 * Returns true when the call is allowed.
 */
export async function hitRateLimit(
  q: Queryable,
  bucket: string,
  windowSeconds: number,
  limit: number,
  now = new Date(),
): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await q.query<{ count: number }>(
    `insert into rate_limit_buckets (bucket, window_start, count) values ($1, $2, 1)
     on conflict (bucket, window_start) do update set count = rate_limit_buckets.count + 1
     returning count`,
    [bucket, windowStart],
  );
  return (rows[0]?.count ?? 0) <= limit;
}

export async function pruneRateLimits(q: Queryable): Promise<void> {
  await q.query("delete from rate_limit_buckets where window_start < now() - interval '2 days'");
}
