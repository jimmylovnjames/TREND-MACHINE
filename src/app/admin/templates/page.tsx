import { getDb } from "@/server/db";
import { evaluateReadiness } from "@/server/generation/service";
import { listTemplates } from "@/server/repo/templates";
import { isAdmin } from "@/server/security/admin";
import { Card, fmtDate, Pill, Table } from "../ui";

export default async function AdminTemplates() {
  if (!(await isAdmin())) return null;
  const db = await getDb();
  const templates = await listTemplates(db, ["DRAFT", "PREVIEW", "LIVE", "RETIRED"]);
  const versions = await db.query<{
    template_id: string;
    version: number;
    created_by: string;
    change_note: string;
    created_at: Date;
    reference_motion_asset_id: string | null;
    spec_hash: string;
  }>(
    "select template_id, version, created_by, change_note, created_at, reference_motion_asset_id, spec_hash from template_versions order by template_id, version desc",
  );
  const withReadiness = await Promise.all(
    templates.map(async (t) => ({ t, r: await evaluateReadiness(db, t) })),
  );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Templates</h1>
      <p className="text-sm text-muted">
        Templates are edited as JSON in <code>content/templates/</code> and synced with{" "}
        <code>npm run db:seed</code>. Every change creates a new immutable version; jobs pin the exact version
        they used.
      </p>
      <Card title="Current">
        <Table
          head={["Template", "Status", "Version", "Reference motion", "Readiness", "Routing"]}
          rows={withReadiness.map(({ t, r }) => [
            <span key="n">
              <b>{t.spec.name}</b>
              <br />
              <span className="text-xs text-muted">{t.id}</span>
            </span>,
            t.status,
            `v${t.version}`,
            t.reference ? (
              <Pill tone={t.reference.status === "READY" ? "ok" : "warn"}>{t.reference.status}</Pill>
            ) : (
              <Pill tone="warn">REFERENCE_MOTION_PENDING</Pill>
            ),
            r.ready ? (
              <Pill tone="ok">ready</Pill>
            ) : (
              r.blockers.map((b) => (
                <Pill key={b.code} tone="bad">
                  {b.code}
                </Pill>
              ))
            ),
            <span key="c" className="text-xs text-muted">
              {r.routing.candidates.map((c) => `${c.providerId}:${c.model} (${c.score})`).join(" → ") || "—"}
              {r.routing.rejected.length > 0 && (
                <>
                  <br />
                  rejected:{" "}
                  {r.routing.rejected.map((x) => `${x.providerId}:${x.model}=${x.reason}`).join(", ")}
                </>
              )}
            </span>,
          ])}
        />
      </Card>
      <Card title="Version history">
        <Table
          head={["Template", "Version", "Created", "By", "Note", "Reference asset", "Hash"]}
          rows={versions.map((v) => [
            v.template_id,
            `v${v.version}`,
            fmtDate(v.created_at),
            v.created_by,
            v.change_note,
            v.reference_motion_asset_id ?? "—",
            <code key="h" className="text-xs">
              {v.spec_hash.slice(0, 10)}
            </code>,
          ])}
        />
      </Card>
    </div>
  );
}
