import { DIFFICULTY_LABELS, ENERGY_LABELS } from "@/domain/template";

export function Meter({ value, label, color = "bg-acid" }: { value: number; label: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`${label}: ${value} of 5`}>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`h-2.5 w-1.5 rounded-sm ${i <= value ? color : "bg-line"}`} />
        ))}
      </span>
    </span>
  );
}

export function StatRow({
  duration,
  energy,
  difficulty,
  compact = false,
}: {
  duration: number;
  energy: number;
  difficulty: number;
  compact?: boolean;
}) {
  return (
    <dl
      className={`flex flex-wrap items-center ${compact ? "gap-x-3 gap-y-1 text-[11px]" : "gap-x-5 gap-y-2 text-sm"} text-muted`}
    >
      <div className="flex items-center gap-1.5">
        <dt className="sr-only">Length</dt>
        <dd className="font-semibold text-fg">{duration}s</dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt>{compact ? "Energy" : "Energy"}</dt>
        <dd className="flex items-center gap-1.5">
          <Meter value={energy} label="Energy" color="bg-hot" />
          {!compact && <span className="text-fg">{ENERGY_LABELS[energy]}</span>}
        </dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt>{compact ? "Diff" : "Difficulty"}</dt>
        <dd className="flex items-center gap-1.5">
          <Meter value={difficulty} label="Difficulty" color="bg-cyan" />
          {!compact && <span className="text-fg">{DIFFICULTY_LABELS[difficulty]}</span>}
        </dd>
      </div>
    </dl>
  );
}

export function Badge({
  children,
  tone = "acid",
}: {
  children: React.ReactNode;
  tone?: "acid" | "hot" | "muted" | "warn";
}) {
  const tones = {
    acid: "bg-acid text-black",
    hot: "bg-hot text-black",
    muted: "bg-surface-2 text-muted",
    warn: "bg-warn text-black",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
