import type { TrendIngest } from "@/domain/lab";
import type { Db } from "../db";

/** Idempotent upsert of an externally-observed trend candidate plus its evidence. */
export async function ingestTrend(db: Db, t: TrendIngest): Promise<{ id: string; created: boolean }> {
  return db.tx(async (q) => {
    const [row] = await q.query<{ id: string; created: boolean }>(
      `insert into trend_candidates (external_ref, name, source_platform, source_url, first_observed_at, last_observed_at,
         movement_description, signature_movement, hook)
       values ($1,$2,$3,$4,$5,$5,$6,$7,$8)
       on conflict (external_ref) do update set
         last_observed_at = greatest(trend_candidates.last_observed_at, excluded.last_observed_at),
         first_observed_at = least(trend_candidates.first_observed_at, excluded.first_observed_at),
         movement_description = case when trend_candidates.movement_description = '' then excluded.movement_description else trend_candidates.movement_description end,
         signature_movement = case when trend_candidates.signature_movement = '' then excluded.signature_movement else trend_candidates.signature_movement end,
         hook = case when trend_candidates.hook = '' then excluded.hook else trend_candidates.hook end,
         updated_at = now()
       returning id, (xmax = 0) as created`,
      [
        t.externalRef,
        t.name,
        t.sourcePlatform,
        t.sourceUrl,
        t.observedAt,
        t.movementDescription,
        t.signatureMovement,
        t.hook,
      ],
    );
    for (const e of t.evidence) {
      await q.query(
        `insert into trend_evidence (trend_id, url, platform, observed_at, note, observed_metrics)
         values ($1,$2,$3,$4,$5,$6) on conflict (trend_id, url, observed_at) do nothing`,
        [
          row!.id,
          e.url,
          e.platform,
          e.observedAt,
          e.note,
          e.observedMetrics ? JSON.stringify(e.observedMetrics) : null,
        ],
      );
    }
    return { id: row!.id, created: row!.created };
  });
}
