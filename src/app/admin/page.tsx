import { getConfig } from "@/server/config";
import { isAdmin } from "@/server/security/admin";
import { overviewData } from "./overview-data";
import { Card, fmtDate, Pill, Rate, Table } from "./ui";

export default async function AdminOverview() {
  if (!(await isAdmin())) return null;
  const cfg = getConfig();
  const d = await overviewData();
  const n = (v: unknown) => Number(v ?? 0);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Overview</h1>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Generation providers">
          <Table
            head={["Provider", "Configured", "Health", "Models"]}
            rows={d.providers.map(({ provider, configured }) => {
              const h = d.health[provider.id];
              const open = h?.unavailableUntil && h.unavailableUntil > new Date();
              return [
                provider.label,
                configured ? <Pill tone="ok">yes</Pill> : <Pill tone="bad">no credentials</Pill>,
                open ? (
                  <Pill tone="bad">circuit open until {fmtDate(h!.unavailableUntil)}</Pill>
                ) : h?.n ? (
                  <Rate num={Math.round((h.successRate ?? 0) * h.n)} den={h.n} min={20} />
                ) : (
                  <span className="text-muted">no data</span>
                ),
                <span key="m" className="text-xs text-muted">
                  {provider
                    .getCapabilities()
                    .models.map((m) => m.id)
                    .join(", ")}
                </span>,
              ];
            })}
          />
        </Card>
        <Card title="Cost controls">
          <ul className="space-y-1 text-sm">
            <li>
              Generation enabled:{" "}
              {cfg.GENERATION_ENABLED ? <Pill tone="ok">yes</Pill> : <Pill tone="bad">paused</Pill>}
            </li>
            <li>Quality tier: {cfg.GENERATION_QUALITY_TIER}</li>
            <li>
              Per device: {cfg.GEN_LIMIT_PER_DEVICE_HOUR}/hour, {cfg.GEN_LIMIT_PER_DEVICE_DAY}/day,{" "}
              {cfg.MAX_ACTIVE_JOBS_PER_DEVICE} concurrent
            </li>
            <li>
              Per IP: {cfg.GEN_LIMIT_PER_IP_DAY}/day · Global: {cfg.GEN_LIMIT_GLOBAL_DAY}/day,{" "}
              {cfg.MAX_ACTIVE_JOBS_GLOBAL} concurrent
            </li>
            <li>
              Daily budget: {cfg.DAILY_BUDGET_USD !== undefined ? `$${cfg.DAILY_BUDGET_USD}` : "not set"}
            </li>
            <li>
              Retention: photos {cfg.SOURCE_RETENTION_HOURS}h · videos {cfg.RESULT_RETENTION_DAYS}d
            </li>
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Jobs by status">
          <Table head={["Status", "Jobs"]} rows={d.statusCounts.map((r) => [r.status, r.n])} />
        </Card>
        <Card title="Generation errors">
          <Table
            head={["Code", "Provider", "Count", "Last seen"]}
            rows={d.errors.map((e) => [
              e.error_code,
              e.provider_id ?? "—",
              e.occurrences,
              fmtDate(e.last_seen),
            ])}
          />
        </Card>
      </div>

      <Card title="Provider reliability (measured)">
        <Table
          head={["Provider", "Model", "Submitted", "Success", "p50", "p90", "Recorded cost"]}
          rows={d.reliability.map((r) => [
            r.provider_id,
            r.provider_model,
            r.submitted,
            <Rate key="s" num={n(r.completed)} den={n(r.completed) + n(r.failed)} min={20} />,
            r.p50_seconds ? `${Math.round(n(r.p50_seconds))}s` : "—",
            r.p90_seconds ? `${Math.round(n(r.p90_seconds))}s` : "—",
            r.recorded_cost_usd ? `$${n(r.recorded_cost_usd).toFixed(2)} (${r.jobs_with_cost} jobs)` : "—",
          ])}
          empty="No provider submissions yet."
        />
      </Card>

      <Card title="Template funnel (measured)">
        <Table
          head={[
            "Template",
            "Impr.",
            "Impr→View",
            "View→Gen",
            "Gen success",
            "Regen rate",
            "Download rate",
            "Share rate",
            "p50 latency",
          ]}
          rows={d.funnel.map((f) => [
            `${f.slug} v${f.current_version}`,
            f.impressions,
            <Rate key="a" num={n(f.views)} den={n(f.impressions)} />,
            <Rate key="b" num={n(f.generations_requested)} den={n(f.views)} />,
            <Rate
              key="c"
              num={n(f.generations_completed)}
              den={n(f.generations_completed) + n(f.generations_failed)}
            />,
            <Rate key="d" num={n(f.regenerations)} den={n(f.generations_completed)} />,
            <Rate key="e" num={n(f.downloads)} den={n(f.generations_completed)} />,
            <Rate key="f" num={n(f.shares)} den={n(f.generations_completed)} />,
            f.p50_latency_ms ? `${Math.round(n(f.p50_latency_ms) / 1000)}s` : "—",
          ])}
        />
        <p className="mt-3 text-xs text-muted">
          Rates show sample size; “low n” means the number is not meaningful yet. No conclusions are drawn
          automatically.
        </p>
      </Card>

      <Card title="Movement characteristics — designed intent vs. observed behaviour">
        <p className="mb-3 text-xs text-muted">
          Scores are the choreographer&apos;s designed intent (0–5), not measurements. They are joined to
          observed counts so patterns can be studied once there is enough data.
        </p>
        <Table
          head={["Characteristic", "Designed", "Template", "Views", "Completed", "Shares"]}
          rows={d.characteristics.map((c) => [
            c.characteristic,
            c.designed_score,
            c.template_id,
            c.views,
            c.generations_completed,
            c.shares,
          ])}
        />
      </Card>
    </div>
  );
}
