export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">{title}</h2>}
      {children}
    </section>
  );
}

export function Table({
  head,
  rows,
  empty = "Nothing yet.",
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty?: string;
}) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-line px-2 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 align-top">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "ok" | "bad" | "warn" | "muted";
}) {
  const t = {
    ok: "bg-acid/15 text-acid",
    bad: "bg-danger/15 text-danger",
    warn: "bg-warn/15 text-warn",
    muted: "bg-surface-2 text-muted",
  }[tone];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>
  );
}

/** Show a rate only with its sample size, and flag small samples instead of implying conclusions. */
export function Rate({ num, den, min = 30 }: { num: number; den: number; min?: number }) {
  if (!den) return <span className="text-muted">—</span>;
  const pct = ((num / den) * 100).toFixed(1);
  return (
    <span title={`${num}/${den}`}>
      {pct}% <span className="text-xs text-muted">(n={den})</span>
      {den < min && <span className="ml-1 text-xs text-warn">low n</span>}
    </span>
  );
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16);
}
