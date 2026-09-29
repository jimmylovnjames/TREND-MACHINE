import "server-only";
import type { AnalyticsEventName, DeviceClass } from "@/domain/analytics";
import type { Queryable } from "../db";

export interface ServerEvent {
  name: AnalyticsEventName;
  source?: "client" | "server";
  occurredAt?: Date;
  anonId?: string | null;
  sessionId?: string | null;
  templateId?: string | null;
  templateVersion?: number | null;
  jobId?: string | null;
  providerId?: string | null;
  providerModel?: string | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  costUsd?: number | null;
  deviceClass?: DeviceClass | null;
  props?: Record<string, unknown>;
}

/** Append an analytics event. Analytics must never break the product: errors are swallowed. */
export async function track(q: Queryable, e: ServerEvent): Promise<void> {
  try {
    await q.query(
      `insert into analytics_events (name, occurred_at, source, anon_id, session_id, template_id, template_version,
         job_id, provider_id, provider_model, error_code, latency_ms, cost_usd, device_class, props)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        e.name,
        e.occurredAt ?? new Date(),
        e.source ?? "server",
        e.anonId ?? null,
        e.sessionId ?? null,
        e.templateId ?? null,
        e.templateVersion ?? null,
        e.jobId ?? null,
        e.providerId ?? null,
        e.providerModel ?? null,
        e.errorCode ?? null,
        e.latencyMs ?? null,
        e.costUsd ?? null,
        e.deviceClass ?? null,
        JSON.stringify(e.props ?? {}),
      ],
    );
  } catch (err) {
    console.error("[analytics] failed to record event", e.name, err instanceof Error ? err.message : err);
  }
}
