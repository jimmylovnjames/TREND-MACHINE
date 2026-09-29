import "server-only";
import { getDb } from "@/server/db";
import { getProviderHealth } from "@/server/generation/health";
import { registeredProviders } from "@/server/providers/registry";

export async function overviewData() {
  const db = await getDb();
  const [providers, health, statusCounts, reliability, errors, funnel, characteristics] = await Promise.all([
    registeredProviders(),
    getProviderHealth(db),
    db.query<{ status: string; n: number }>(
      "select status, count(*)::int as n from generation_jobs group by status order by status",
    ),
    db.query<Record<string, string | number | null>>(
      "select * from provider_reliability order by provider_id, provider_model",
    ),
    db.query<{ error_code: string; provider_id: string | null; occurrences: number; last_seen: Date }>(
      "select * from generation_errors order by occurrences desc limit 20",
    ),
    db.query<Record<string, number | string | null>>("select * from template_funnel order by slug"),
    db.query<{
      characteristic: string;
      designed_score: number;
      template_id: string;
      views: number;
      generations_completed: number;
      shares: number;
    }>("select * from characteristic_performance order by characteristic, designed_score desc"),
  ]);
  return { providers, health, statusCounts, reliability, errors, funnel, characteristics };
}
