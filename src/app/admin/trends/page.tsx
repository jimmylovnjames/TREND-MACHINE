import { SOURCE_PLATFORMS, TREND_STATUSES } from "@/domain/lab";
import { MOVEMENT_CHARACTERISTICS } from "@/domain/template";
import { getDb } from "@/server/db";
import { isAdmin } from "@/server/security/admin";
import { ActionForm, areaCls, inputCls } from "../ActionForm";
import { addCountertrendAction, addMechanicAction, createTrendAction, reviewTrendAction } from "../actions";
import { Card, fmtDate, Pill } from "../ui";

interface TrendRow {
  id: string;
  name: string;
  source_platform: string;
  source_url: string;
  first_observed_at: Date;
  last_observed_at: Date;
  movement_description: string;
  signature_movement: string;
  hook: string;
  loopability: number | null;
  motion_transfer_suitability: number | null;
  single_photo_suitability: number | null;
  reproduction_difficulty: number | null;
  notes: string;
  status: string;
}

export default async function AdminTrends() {
  if (!(await isAdmin())) return null;
  const db = await getDb();
  const trends = await db.query<TrendRow>(
    "select * from trend_candidates order by last_observed_at desc limit 100",
  );
  const evidence = await db.query<{
    trend_id: string;
    url: string;
    platform: string;
    observed_at: Date;
    note: string;
    observed_metrics: Record<string, number> | null;
  }>(
    "select trend_id, url, platform, observed_at, note, observed_metrics from trend_evidence order by observed_at desc",
  );
  const mechanics = await db.query<{
    trend_id: string;
    characteristic: string;
    score: number | null;
    rationale: string;
    assessed_by: string;
    assessor: string;
  }>(
    "select trend_id, characteristic, score, rationale, assessed_by, assessor from trend_mechanics order by created_at",
  );
  const counters = await db.query<{
    trend_id: string;
    concept_id: string;
    mechanics_exploited: string[];
    differentiation: string;
    status: string;
  }>("select trend_id, concept_id, mechanics_exploited, differentiation, status from countertrends");
  const concepts = await db.query<{ id: string; name: string }>(
    "select id, name from dance_concepts order by name",
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Trend Lab</h1>
      <p className="text-sm text-muted">
        Candidates arrive from the external scanner (<code>POST /api/admin/trends/ingest</code>, bearer{" "}
        <code>TREND_INGEST_TOKEN</code>) or are added by hand. Only observed facts are stored — no metrics are
        invented. Mechanics analysis explains <i>why</i> a movement works; countertrends link it to an
        original concept that exploits the mechanics without copying choreography.
      </p>

      <Card title="Add candidate manually">
        <ActionForm action={createTrendAction} submitLabel="Add candidate">
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="name" required placeholder="Working name" className={inputCls} />
            <select name="sourcePlatform" className={inputCls} defaultValue="tiktok">
              {SOURCE_PLATFORMS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <input name="sourceUrl" required type="url" placeholder="Source URL" className={inputCls} />
            <input name="observedAt" type="datetime-local" className={inputCls} />
          </div>
          <textarea
            name="movementDescription"
            placeholder="Movement description"
            className={areaCls}
            rows={2}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="signatureMovement" placeholder="Signature movement" className={inputCls} />
            <input name="hook" placeholder="Hook" className={inputCls} />
          </div>
        </ActionForm>
      </Card>

      {trends.length === 0 && <p className="text-sm text-muted">No trend candidates yet.</p>}
      {trends.map((t) => (
        <Card key={t.id} title={t.name}>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3 text-sm">
              <p>
                <Pill
                  tone={
                    t.status === "APPROVED" || t.status === "TEMPLATE_CREATED"
                      ? "ok"
                      : t.status === "REJECTED"
                        ? "bad"
                        : "warn"
                  }
                >
                  {t.status}
                </Pill>{" "}
                <span className="text-muted">
                  {t.source_platform} · first {fmtDate(t.first_observed_at)} · last{" "}
                  {fmtDate(t.last_observed_at)}
                </span>
              </p>
              <p className="break-all text-xs text-muted">{t.source_url}</p>
              {t.movement_description && <p>{t.movement_description}</p>}
              {t.signature_movement && <p className="text-muted">Signature: {t.signature_movement}</p>}
              {t.hook && <p className="text-muted">Hook: {t.hook}</p>}
              <div>
                <p className="font-semibold">Evidence</p>
                <ul className="mt-1 space-y-1 text-xs text-muted">
                  {evidence
                    .filter((e) => e.trend_id === t.id)
                    .map((e) => (
                      <li key={e.url + e.observed_at} className="break-all">
                        {fmtDate(e.observed_at)} · {e.platform} · {e.url}
                        {e.observed_metrics && ` · observed: ${JSON.stringify(e.observed_metrics)}`}
                        {e.note && ` · ${e.note}`}
                      </li>
                    ))}
                  {!evidence.some((e) => e.trend_id === t.id) && <li>none recorded</li>}
                </ul>
              </div>
              <div>
                <p className="font-semibold">Mechanics (why it works)</p>
                <ul className="mt-1 space-y-1 text-xs text-muted">
                  {mechanics
                    .filter((m) => m.trend_id === t.id)
                    .map((m, i) => (
                      <li key={i}>
                        <b className="text-fg">{m.characteristic}</b> {m.score ?? "–"}/5 — {m.rationale}{" "}
                        <i>
                          ({m.assessed_by.toLowerCase()}: {m.assessor})
                        </i>
                      </li>
                    ))}
                  {!mechanics.some((m) => m.trend_id === t.id) && <li>not analysed yet</li>}
                </ul>
              </div>
              <div>
                <p className="font-semibold">Countertrends</p>
                <ul className="mt-1 space-y-1 text-xs text-muted">
                  {counters
                    .filter((c) => c.trend_id === t.id)
                    .map((c) => (
                      <li key={c.concept_id}>
                        <b className="text-fg">{c.concept_id}</b> exploits {c.mechanics_exploited.join(", ")}{" "}
                        — {c.differentiation} <Pill>{c.status}</Pill>
                      </li>
                    ))}
                  {!counters.some((c) => c.trend_id === t.id) && <li>none</li>}
                </ul>
              </div>
            </div>
            <div className="space-y-5">
              <ActionForm action={reviewTrendAction} submitLabel="Save review">
                <input type="hidden" name="id" value={t.id} />
                <select name="status" defaultValue={t.status} className={inputCls}>
                  {TREND_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                  {(
                    [
                      ["loopability", t.loopability],
                      ["motionTransferSuitability", t.motion_transfer_suitability],
                      ["singlePhotoSuitability", t.single_photo_suitability],
                      ["reproductionDifficulty", t.reproduction_difficulty],
                    ] as const
                  ).map(([k, v]) => (
                    <label key={k}>
                      {k} (1–5)
                      <input
                        name={k}
                        type="number"
                        min={1}
                        max={5}
                        defaultValue={v ?? ""}
                        className={inputCls}
                      />
                    </label>
                  ))}
                </div>
                <textarea
                  name="notes"
                  defaultValue={t.notes}
                  placeholder="Notes"
                  rows={2}
                  className={areaCls}
                />
              </ActionForm>
              <ActionForm action={addMechanicAction} submitLabel="Add mechanic">
                <input type="hidden" name="trendId" value={t.id} />
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <select name="characteristic" className={inputCls}>
                    {MOVEMENT_CHARACTERISTICS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <input name="score" type="number" min={0} max={5} placeholder="0–5" className={inputCls} />
                </div>
                <textarea
                  name="rationale"
                  required
                  placeholder="Why this characteristic matters here"
                  rows={2}
                  className={areaCls}
                />
                <input name="assessor" placeholder="Your name" className={inputCls} />
              </ActionForm>
              <ActionForm action={addCountertrendAction} submitLabel="Link countertrend">
                <input type="hidden" name="trendId" value={t.id} />
                <select name="conceptId" className={inputCls}>
                  {concepts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <fieldset className="grid grid-cols-2 gap-1 text-xs">
                  {MOVEMENT_CHARACTERISTICS.map((c) => (
                    <label key={c} className="flex items-center gap-1">
                      <input type="checkbox" name="mechanicsExploited" value={c} /> {c}
                    </label>
                  ))}
                </fieldset>
                <textarea
                  name="differentiation"
                  required
                  placeholder="How the original concept differs from the trend's choreography"
                  rows={2}
                  className={areaCls}
                />
              </ActionForm>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
