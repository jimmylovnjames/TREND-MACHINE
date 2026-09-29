import "server-only";
import type { Queryable } from "../db";
import type { ProviderHealth } from "../providers/router";

/**
 * Provider health = in-process circuit breaker (opened on credential/availability
 * errors) + observed success/latency stats from recent jobs.
 */

const CIRCUIT_MS = 5 * 60_000;
type G = typeof globalThis & {
  __tmCircuit?: Map<string, number>;
  __tmHealthCache?: { at: number; data: Record<string, ProviderHealth> };
};
const g = globalThis as G;
const circuit = (g.__tmCircuit ??= new Map<string, number>());

export function openCircuit(providerId: string, now = Date.now()): void {
  circuit.set(providerId, now + CIRCUIT_MS);
}

export function resetHealthForTests(): void {
  circuit.clear();
  g.__tmHealthCache = undefined;
}

export async function getProviderHealth(q: Queryable): Promise<Record<string, ProviderHealth>> {
  const now = Date.now();
  let stats = g.__tmHealthCache && now - g.__tmHealthCache.at < 60_000 ? g.__tmHealthCache.data : undefined;
  if (!stats) {
    const rows = await q.query<{ provider_id: string; n: number; ok: number; p50: number | null }>(
      `select provider_id,
              count(*)::int as n,
              count(*) filter (where status = 'COMPLETED')::int as ok,
              percentile_cont(0.5) within group (order by extract(epoch from (completed_at - submitted_at)))
                filter (where status = 'COMPLETED')::float8 as p50
       from generation_jobs
       where provider_id is not null and status in ('COMPLETED','FAILED')
         and created_at > now() - interval '7 days'
         and coalesce(error_code, '') not in ('PROVIDER_REJECTED','RATE_LIMITED')
       group by provider_id`,
    );
    stats = {};
    for (const r of rows) {
      stats[r.provider_id] = {
        n: r.n,
        successRate: r.n ? r.ok / r.n : undefined,
        p50LatencySeconds: r.p50 ?? undefined,
      };
    }
    g.__tmHealthCache = { at: now, data: stats };
  }
  const out: Record<string, ProviderHealth> = {};
  for (const [id, s] of Object.entries(stats)) out[id] = { ...s };
  for (const [id, until] of circuit) {
    if (until > now) out[id] = { ...(out[id] ?? {}), unavailableUntil: new Date(until) };
  }
  return out;
}
