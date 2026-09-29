import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { track } from "@/server/analytics/track";
import { getDb } from "@/server/db";
import { getTemplateVersion } from "@/server/repo/templates";
import { getStorage } from "@/server/storage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI dance video", robots: { index: false, follow: false } };

async function load(slug: string) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(slug)) return null;
  const db = await getDb();
  const [row] = await db.query<{
    job_id: string;
    template_version_id: string;
    template_id: string;
    template_version: number;
    result_storage_key: string;
  }>(
    `select j.id as job_id, j.template_version_id, j.template_id, j.template_version, j.result_storage_key
     from shares s join generation_jobs j on j.id = s.job_id
     where s.slug = $1 and s.revoked_at is null and j.status = 'COMPLETED'
       and j.result_storage_key is not null and j.result_deleted_at is null`,
    [slug],
  );
  if (!row) return null;
  const rec = await getTemplateVersion(db, row.template_version_id);
  return { db, row, rec };
}

export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { db, row, rec } = data;
  await track(db, {
    name: "share_link_opened",
    templateId: row.template_id,
    templateVersion: row.template_version,
    jobId: row.job_id,
    props: { surface: "share" },
  });
  const url = await getStorage().signedUrl(row.result_storage_key, { ttlSeconds: 3600 });
  const name = rec?.spec.name ?? "Dance";
  return (
    <main className="mx-auto max-w-md px-4 pt-[calc(var(--safe-top)+16px)]">
      <Wordmark className="text-xl" />
      <div className="relative mt-4 overflow-hidden rounded-[var(--radius-card)] bg-black">
        <video
          src={url}
          className="aspect-[9/16] w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          controls
          aria-label={`${name} AI dance video`}
        />
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
          AI-generated
        </span>
      </div>
      <p className="mt-4 font-display text-4xl font-black uppercase leading-none">{name}</p>
      <p className="mt-1 text-sm text-muted">
        Made with TREND MACHINE from a single photo. This video is AI-generated.
      </p>
      {rec && (
        <Link
          href={`/d/${rec.slug}`}
          className="pressable mt-5 flex h-14 items-center justify-center rounded-2xl bg-acid font-display text-2xl font-black uppercase text-black"
        >
          Make your own
        </Link>
      )}
    </main>
  );
}
