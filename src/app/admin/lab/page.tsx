import { CONCEPT_STATUSES, type DanceConcept } from "@/domain/lab";
import { getDb } from "@/server/db";
import { isAdmin } from "@/server/security/admin";
import { ActionForm, inputCls } from "../ActionForm";
import { conceptStatusAction } from "../actions";
import { Card, Pill } from "../ui";

export default async function AdminLab() {
  if (!(await isAdmin())) return null;
  const db = await getDb();
  const concepts = await db.query<{
    id: string;
    status: string;
    spec: DanceConcept;
    template_id: string | null;
  }>("select id, status, spec, template_id from dance_concepts order by name");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Original Dance Lab</h1>
      <p className="text-sm text-muted">
        Lifecycle: {CONCEPT_STATUSES.join(" → ")}. Concept specs live in <code>content/concepts/</code>.
      </p>
      {concepts.map(({ id, status, spec: c, template_id }) => (
        <Card key={id} title={`${c.name} · ${id}`}>
          <div className="grid gap-4 lg:grid-cols-2">
            <dl className="grid gap-1 text-sm text-muted sm:grid-cols-[140px_1fr]">
              <dt className="text-fg">Status</dt>
              <dd>
                <Pill tone={status === "LIVE" ? "ok" : "warn"}>{status}</Pill>
              </dd>
              <dt className="text-fg">Concept</dt>
              <dd>{c.concept}</dd>
              <dt className="text-fg">Hook</dt>
              <dd>{c.hook}</dd>
              <dt className="text-fg">First second</dt>
              <dd>{c.firstSecond}</dd>
              <dt className="text-fg">Signature</dt>
              <dd>{c.signature}</dd>
              <dt className="text-fg">Loop point</dt>
              <dd>{c.loopPoint}</dd>
              <dt className="text-fg">Energy / difficulty</dt>
              <dd>
                {c.energy}/5 · {c.difficulty}/5 · {c.durationSeconds}s
              </dd>
              <dt className="text-fg">Template</dt>
              <dd>{template_id ?? "—"}</dd>
            </dl>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold">Sequence</p>
                <ol className="mt-1 space-y-1 text-muted">
                  {c.sequence.map((p) => (
                    <li key={p.name}>
                      <span className="font-mono text-xs">{p.at.toFixed(1)}s</span>{" "}
                      <b className="text-fg">{p.name}</b> — {p.description}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="font-semibold">Camera</p>
                <p className="text-muted">{c.cameraGuidance}</p>
              </div>
              <div>
                <p className="font-semibold">Motion-transfer considerations</p>
                <ul className="list-disc pl-5 text-muted">
                  {c.motionTransferConsiderations.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-semibold">Generation guidance</p>
                <p className="text-muted">{c.generationGuidance}</p>
              </div>
              <ActionForm action={conceptStatusAction} submitLabel="Move">
                <input type="hidden" name="id" value={id} />
                <select name="status" defaultValue={status} className={inputCls}>
                  {CONCEPT_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </ActionForm>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
