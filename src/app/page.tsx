import Link from "next/link";
import { TemplateCard } from "@/components/TemplateCard";
import { Wordmark } from "@/components/Wordmark";
import type { PublicTemplate } from "@/domain/template";
import { getDb } from "@/server/db";
import { listTemplates, PUBLIC_STATUSES, toPublicTemplate } from "@/server/repo/templates";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await getDb();
  const templates = (await listTemplates(db, PUBLIC_STATUSES)).map((t) => toPublicTemplate(t));
  const featured = templates.find((t) => t.featured) ?? templates[0];
  const fresh = templates.filter((t) => t.isNew);
  const originals = templates.filter((t) => t.category === "ORIGINAL");

  return (
    <main className="mx-auto max-w-2xl pt-safe">
      <header className="flex items-center justify-between px-5 pt-5">
        <Wordmark className="text-2xl" />
        <Link
          href="/about"
          className="pressable rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted"
        >
          How it works
        </Link>
      </header>

      <section className="px-5 pb-4 pt-8">
        <h1 className="font-display text-[15vw] font-black uppercase leading-[0.82] tracking-tight sm:text-7xl">
          Make the <span className="text-acid">next</span> move
        </h1>
        <p className="mt-3 max-w-sm text-base text-muted">Pick a move. Add your photo. Become the video.</p>
      </section>

      {featured && (
        <section aria-labelledby="featured-h" className="px-5">
          <h2 id="featured-h" className="sr-only">
            Featured dance
          </h2>
          <TemplateCard t={featured} section="featured" position={0} size="lg" />
        </section>
      )}

      <section aria-labelledby="trending-h" className="mt-10 px-5">
        <SectionHeader id="trending-h" title="Trending" />
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          No trending moves yet. This row will only show moves with real audience data — we don&apos;t fake
          it.
        </p>
      </section>

      {fresh.length > 0 && <Rail id="new" title="New" items={fresh} section="new" />}
      {originals.length > 0 && (
        <Rail
          id="originals"
          title="Originals"
          items={originals}
          section="originals"
          subtitle="Moves designed in-house by TREND MACHINE"
        />
      )}

      <footer className="mt-12 space-y-2 px-5 text-xs text-muted">
        <p>Videos are AI-generated. Only use photos you have permission to use.</p>
        <p className="flex gap-4">
          <Link className="underline underline-offset-4" href="/privacy">
            Privacy &amp; retention
          </Link>
          <Link className="underline underline-offset-4" href="/about">
            About AI videos
          </Link>
        </p>
      </footer>
    </main>
  );
}

function SectionHeader({ id, title, subtitle }: { id: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="font-display text-3xl font-black uppercase leading-none">
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

function Rail({
  id,
  title,
  subtitle,
  items,
  section,
}: {
  id: string;
  title: string;
  subtitle?: string;
  items: PublicTemplate[];
  section: "new" | "originals";
}) {
  return (
    <section aria-labelledby={`${id}-h`} className="mt-10">
      <div className="px-5">
        <SectionHeader id={`${id}-h`} title={title} subtitle={subtitle} />
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-2">
        {items.map((t, i) => (
          <TemplateCard key={t.id} t={t} section={section} position={i} />
        ))}
      </div>
    </section>
  );
}
