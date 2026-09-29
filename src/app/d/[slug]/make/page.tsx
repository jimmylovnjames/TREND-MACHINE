import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MakeFlow } from "@/components/make/MakeFlow";
import { getDb } from "@/server/db";
import { getTemplateBySlug, PUBLIC_STATUSES, toPublicTemplate } from "@/server/repo/templates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add your photo", robots: { index: false } };

export default async function MakePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) notFound();
  const rec = await getTemplateBySlug(await getDb(), slug);
  if (!rec || !PUBLIC_STATUSES.includes(rec.status)) notFound();
  return <MakeFlow template={toPublicTemplate(rec)} />;
}
