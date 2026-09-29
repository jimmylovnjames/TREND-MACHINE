"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { trackImpression } from "@/client/analytics";
import type { PublicTemplate } from "@/domain/template";
import { MotionSketch } from "./MotionSketch";
import { Badge, StatRow } from "./Stats";

type Section = "featured" | "trending" | "new" | "originals";

export function TemplateCard({
  t,
  section,
  position,
  size = "md",
}: {
  t: PublicTemplate;
  section: Section;
  position: number;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
          trackImpression(t.id, t.version, section, position);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [t.id, t.version, section, position]);

  const large = size === "lg";
  return (
    <Link
      ref={ref}
      href={`/d/${t.slug}`}
      className={`pressable group relative block shrink-0 snap-start overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface ${large ? "w-full" : "w-[44vw] max-w-[220px]"}`}
      aria-label={`${t.name}: ${t.tagline}`}
    >
      <div className={`relative ${large ? "aspect-[4/5]" : "aspect-[9/16]"}`}>
        <MotionSketch
          motif={t.artwork.motif}
          palette={t.artwork.palette}
          label={t.name}
          className="absolute inset-0"
          showLabel={large}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-3 pt-16">
          <div className="mb-1.5 flex flex-wrap gap-1">
            {t.category === "ORIGINAL" && <Badge>Original</Badge>}
            {t.isNew && <Badge tone="hot">New</Badge>}
          </div>
          <h3
            className={`font-display font-black uppercase leading-[0.9] ${large ? "text-5xl" : "text-2xl"}`}
          >
            {t.name}
          </h3>
          <p className={`mt-1 text-muted ${large ? "text-base" : "line-clamp-2 text-xs"}`}>{t.tagline}</p>
          <div className="mt-2">
            <StatRow
              duration={t.durationSeconds}
              energy={t.energy}
              difficulty={t.difficulty}
              compact={!large}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}
