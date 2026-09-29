import type { DanceConcept } from "@/domain/lab";
import { getDb } from "@/server/db";
import { SUITABILITY_CHECKS } from "@/server/reference";
import type { ReferenceAssetRow } from "@/server/repo/templates";
import { isAdmin } from "@/server/security/admin";
import { getStorage } from "@/server/storage";
import { ActionForm, inputCls } from "../ActionForm";
import { approveReferenceAction, rejectReferenceAction } from "../actions";
import { Card, fmtDate, Pill } from "../ui";

export default async function AdminReferences() {
  if (!(await isAdmin())) return null;
  const db = await getDb();
  const assets = await db.query<ReferenceAssetRow>(
    "select * from reference_motion_assets order by created_at desc",
  );
  const pending = await db.query<{ id: string; name: string; concept: DanceConcept | null }>(
    `select t.id, v.spec->>'name' as name, c.spec as concept
     from templates t join template_versions v on v.template_id = t.id and v.version = t.current_version
     left join reference_motion_assets r on r.id = v.reference_motion_asset_id
     left join dance_concepts c on c.template_id = t.id
     where r.id is null or r.status <> 'READY' order by t.sort_order`,
  );
  const storage = getStorage();
  const urls = Object.fromEntries(
    await Promise.all(
      assets.map(async (a) => [a.id, await storage.signedUrl(a.storage_key, { ttlSeconds: 900 })] as const),
    ),
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Reference motion library</h1>
      <Card title="How to add reference motion">
        <p className="text-sm text-muted">
          Register an owned MP4 with provenance using the CLI, then review and approve it here. Never upload
          footage you don&apos;t own or have written permission for.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ink p-3 text-xs">{`npm run reference:add -- --file glitch.mp4 --template tpl_glitch_walk \\
  --creator "Performer name" --owner "TREND MACHINE" --method STUDIO_CAPTURE \\
  --license "Work-for-hire, all rights assigned" --evidence "Release #2026-014" --captured 2026-10-02`}</pre>
      </Card>

      <Card title={`Templates waiting for reference motion (${pending.length})`}>
        <ul className="space-y-3 text-sm">
          {pending.map((p) => (
            <li key={p.id} className="rounded-xl border border-line p-3">
              <p className="font-semibold">
                {p.name} <span className="text-xs text-muted">{p.id}</span>{" "}
                <Pill tone="warn">REFERENCE_MOTION_PENDING</Pill>
              </p>
              {p.concept && (
                <dl className="mt-2 grid gap-1 text-muted sm:grid-cols-[140px_1fr]">
                  <dt className="font-semibold text-fg">Performer brief</dt>
                  <dd>{p.concept.referenceCapture.performerBrief}</dd>
                  <dt className="font-semibold text-fg">Framing</dt>
                  <dd>{p.concept.referenceCapture.framing}</dd>
                  <dt className="font-semibold text-fg">Wardrobe</dt>
                  <dd>{p.concept.referenceCapture.wardrobe}</dd>
                  <dt className="font-semibold text-fg">Duration</dt>
                  <dd>{p.concept.durationSeconds}s (3–30s accepted)</dd>
                </dl>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {assets.length === 0 && <p className="text-sm text-muted">No reference assets registered yet.</p>}
      {assets.map((a) => (
        <Card key={a.id} title={`${a.template_id ?? "library"} · ${a.id}`}>
          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <video
              src={urls[a.id]}
              controls
              muted
              playsInline
              preload="metadata"
              className="aspect-[9/16] w-full rounded-lg bg-black"
            />
            <div className="space-y-3 text-sm">
              <p>
                <Pill tone={a.status === "READY" ? "ok" : a.status === "UPLOADED" ? "warn" : "bad"}>
                  {a.status}
                </Pill>{" "}
                {a.width}x{a.height} · {a.duration_seconds}s · fps {a.fps ?? "?"} ·{" "}
                {(Number(a.bytes) / 1e6).toFixed(1)} MB · audio {String(a.has_audio)}
              </p>
              <dl className="grid gap-1 text-muted sm:grid-cols-[150px_1fr]">
                <dt className="text-fg">Creator</dt>
                <dd>{a.creator}</dd>
                <dt className="text-fg">Owner</dt>
                <dd>{a.owner}</dd>
                <dt className="text-fg">Method</dt>
                <dd>{a.creation_method}</dd>
                <dt className="text-fg">License</dt>
                <dd>{a.license}</dd>
                <dt className="text-fg">Permission evidence</dt>
                <dd>{a.permission_evidence}</dd>
                <dt className="text-fg">Captured</dt>
                <dd>{a.captured_on ? String(a.captured_on).slice(0, 10) : "—"}</dd>
                <dt className="text-fg">Registered</dt>
                <dd>{fmtDate(a.created_at)}</dd>
                <dt className="text-fg">Reviewed</dt>
                <dd>{a.reviewed_by ? `${a.reviewed_by} · ${fmtDate(a.reviewed_at)}` : "—"}</dd>
                <dt className="text-fg">Warnings</dt>
                <dd>{((a.suitability?.warnings as string[] | undefined) ?? []).join("; ") || "none"}</dd>
                <dt className="text-fg">Notes</dt>
                <dd className="whitespace-pre-wrap">{a.notes || "—"}</dd>
              </dl>
              {a.status === "UPLOADED" && (
                <ActionForm action={approveReferenceAction} submitLabel="Approve for generation">
                  <input type="hidden" name="id" value={a.id} />
                  <fieldset className="grid gap-1 sm:grid-cols-2">
                    <legend className="mb-1 text-xs font-semibold uppercase text-muted">
                      I reviewed the footage and confirm:
                    </legend>
                    {SUITABILITY_CHECKS.map((c) => (
                      <label key={c} className="flex items-center gap-2">
                        <input type="checkbox" name={c} className="h-4 w-4" /> {c.replace(/_/g, " ")}
                      </label>
                    ))}
                  </fieldset>
                  <input name="reviewer" required placeholder="Reviewer name" className={inputCls} />
                </ActionForm>
              )}
              {(a.status === "UPLOADED" || a.status === "READY") && (
                <ActionForm
                  action={rejectReferenceAction}
                  submitLabel={a.status === "READY" ? "Retire" : "Reject"}
                  danger
                >
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="status" value={a.status === "READY" ? "RETIRED" : "REJECTED"} />
                  <input name="reason" required minLength={3} placeholder="Reason" className={inputCls} />
                </ActionForm>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
