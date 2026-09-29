import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MotionSketch } from "@/components/MotionSketch";
import { Badge, StatRow } from "@/components/Stats";
import { TemplateViewTracker, UseThisDance } from "@/components/TemplateActions";
import { getDb } from "@/server/db";
import { evaluateReadiness } from "@/server/generation/service";
import { getTemplateBySlug, PUBLIC_STATUSES, toPublicTemplate } from "@/server/repo/templates";

export const dynamic = "force-dynamic";

// Memoized per request: metadata and page share one DB round-trip.
const load = cache(async function load(slug: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const db = await getDb();
  const rec = await getTemplateBySlug(db, slug);
  if (!rec || !PUBLIC_STATUSES.includes(rec.status)) return null;
  return { rec, readiness: await evaluateReadiness(db, rec) };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await load((await params).slug);
  if (!data) return { title: "Dance not found" };
  return { title: data.rec.spec.name, description: data.rec.spec.hook };
}

export default async function TemplatePage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { rec, readiness } = data;
  const t = toPublicTemplate(rec);
  const s = rec.spec;

  return (
    <main className="mx-auto max-w-2xl pb-[calc(var(--safe-bottom)+120px)]">
      <TemplateViewTracker templateId={t.id} version={t.version} />
      <div className="relative">
        <div className="relative mx-auto mt-[calc(var(--safe-top)+8px)] aspect-[9/16] max-h-[70dvh] w-[calc(100%-24px)] max-w-[calc(70dvh*9/16)] overflow-hidden rounded-[var(--radius-card)] border border-line">
          <MotionSketch
            motif={s.artwork.motif}
            palette={s.artwork.palette}
            label={`${s.name} motion sketch`}
            className="absolute inset-0"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/60 to-transparent px-5 pb-5 pt-24">
            <div className="mb-2 flex gap-1.5">
              {t.category === "ORIGINAL" && <Badge>TREND MACHINE Original</Badge>}
              {t.isNew && <Badge tone="hot">New</Badge>}
            </div>
            <h1 className="font-display text-6xl font-black uppercase leading-[0.85]">{s.name}</h1>
          </div>
        </div>
        <Link
          href="/"
          aria-label="Back to all moves"
          className="pressable absolute left-4 top-[calc(var(--safe-top)+12px)] grid h-11 w-11 place-items-center rounded-full bg-black/60 text-xl backdrop-blur"
        >
          <span aria-hidden="true">←</span>
        </Link>
      </div>

      <div className="space-y-7 px-5 pt-5">
        {readiness.blockers.length > 0 && (
          <div role="note" className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
            <p className="font-semibold text-warn">This dance can&apos;t render yet</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
              {readiness.blockers.map((b) => (
                <li key={b.code}>{b.message}</li>
              ))}
            </ul>
            <p className="mt-2 text-muted">
              You can still walk through the steps — we&apos;ll tell you exactly what&apos;s missing, and your
              photo won&apos;t be sent anywhere.
            </p>
          </div>
        )}
        <div>
          <p className="text-xl font-semibold leading-snug">{s.hook}</p>
          <p className="mt-3 text-muted">{s.description}</p>
          <div className="mt-4">
            <StatRow duration={s.durationSeconds} energy={s.energy} difficulty={s.difficulty} />
          </div>
        </div>

        <section aria-labelledby="moves-h">
          <h2 id="moves-h" className="font-display text-2xl font-black uppercase">
            The move
          </h2>
          <p className="mt-2 text-sm">
            <span className="font-semibold text-acid">First second · </span>
            <span className="text-muted">{s.movement.firstSecond}</span>
          </p>
          <ol className="mt-4 space-y-2">
            {s.movement.sequence.map((p) => (
              <li key={p.name} className="flex gap-3 rounded-xl bg-surface p-3">
                <span className="w-10 shrink-0 font-mono text-xs text-muted">{p.at.toFixed(1)}s</span>
                <span>
                  <span className="font-semibold">{p.name}</span>
                  <span className="block text-sm text-muted">{p.description}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-muted">
            <span className="font-semibold text-fg">Signature: </span>
            {s.movement.signature}
          </p>
        </section>

        <section aria-labelledby="prov-h" className="rounded-2xl border border-line p-4 text-sm">
          <h2 id="prov-h" className="font-semibold">
            Where this move comes from
          </h2>
          <ul className="mt-2 space-y-1 text-muted">
            <li>
              Choreography: {s.rights.choreographyOwner} —{" "}
              {s.provenance.method === "IN_HOUSE_ORIGINAL"
                ? "original concept"
                : s.provenance.method.toLowerCase()}
            </li>
            <li>
              {s.rights.musicIncluded
                ? "Includes a licensed track"
                : "No music included — add your own sound when you post"}
            </li>
            <li>The artwork above is a motion sketch, not a generated video.</li>
          </ul>
        </section>
      </div>

      <UseThisDance slug={t.slug} templateId={t.id} version={t.version} ready={readiness.ready} />
    </main>
  );
}
