"use client";

import Link from "next/link";
import { useEffect } from "react";
import { trackEvent } from "@/client/analytics";

export function TemplateViewTracker({ templateId, version }: { templateId: string; version: number }) {
  useEffect(() => {
    trackEvent("template_view", { templateId, templateVersion: version, props: { surface: "detail" } });
  }, [templateId, version]);
  return null;
}

export function UseThisDance({
  slug,
  templateId,
  version,
  ready,
}: {
  slug: string;
  templateId: string;
  version: number;
  ready: boolean;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 px-5 pb-[calc(var(--safe-bottom)+16px)] pt-3 backdrop-blur-md">
      <div className="mx-auto max-w-2xl">
        {!ready && (
          <p className="mb-2 text-center text-xs text-warn">
            Preview only — this dance can&apos;t render yet
          </p>
        )}
        <Link
          href={`/d/${slug}/make`}
          onClick={() =>
            trackEvent("template_selected", {
              templateId,
              templateVersion: version,
              props: { surface: "detail" },
            })
          }
          className="pressable flex h-14 w-full items-center justify-center rounded-2xl bg-acid font-display text-2xl font-black uppercase tracking-wide text-black"
        >
          Use this dance
        </Link>
      </div>
    </div>
  );
}
