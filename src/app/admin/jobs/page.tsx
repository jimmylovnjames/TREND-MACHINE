import { getDb } from "@/server/db";
import type { JobRow } from "@/server/generation/jobs";
import { isAdmin } from "@/server/security/admin";
import { Card, fmtDate, Pill, Table } from "../ui";

export default async function AdminJobs() {
  if (!(await isAdmin())) return null;
  const db = await getDb();
  const jobs = await db.query<JobRow>("select * from generation_jobs order by created_at desc limit 100");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Generation jobs</h1>
      <Card>
        <Table
          head={["Created", "Template", "Status", "Provider", "Error", "Attempts", "Latency", "Cost"]}
          rows={jobs.map((j) => [
            <span key="c" className="whitespace-nowrap text-xs">
              {fmtDate(j.created_at)}
              <br />
              <code className="text-muted">{j.id.slice(0, 8)}</code>
            </span>,
            `${j.template_id} v${j.template_version}`,
            <Pill key="s" tone={j.status === "COMPLETED" ? "ok" : j.status === "FAILED" ? "bad" : "warn"}>
              {j.status}
            </Pill>,
            <span key="p" className="text-xs">
              {j.provider_id ?? "—"}
              <br />
              <span className="text-muted">{j.provider_model ?? ""}</span>
              <br />
              <span className="text-muted">{j.provider_status ?? ""}</span>
            </span>,
            <span key="e" className="text-xs">
              {j.error_code ?? "—"}
              {j.error_detail && (
                <span className="block max-w-xs break-words text-muted">{j.error_detail}</span>
              )}
            </span>,
            <span key="a" className="text-xs text-muted">
              submit {j.submit_attempts} · polls {j.poll_count}
              {(j.routing?.attempts as { providerId: string; ok: boolean; code?: string }[] | undefined)?.map(
                (a, i) => (
                  <span key={i} className="block">
                    {a.providerId}: {a.ok ? "accepted" : a.code}
                  </span>
                ),
              )}
            </span>,
            j.completed_at && j.submitted_at
              ? `${Math.round((new Date(j.completed_at).getTime() - new Date(j.submitted_at).getTime()) / 1000)}s`
              : "—",
            j.cost_usd
              ? `$${Number(j.cost_usd).toFixed(3)} (${j.cost_source?.toLowerCase().replace("_", " ")})`
              : "—",
          ])}
          empty="No jobs yet."
        />
      </Card>
    </div>
  );
}
