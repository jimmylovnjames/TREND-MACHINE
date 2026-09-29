"use client";

import Link from "next/link";

export interface ErrorInfo {
  code: string;
  title: string;
  message: string;
  actions: string[];
}

const ACTION_LABELS: Record<string, string> = {
  RETRY: "Try again",
  CHANGE_PHOTO: "Use a different photo",
  PICK_ANOTHER_DANCE: "Pick another dance",
  TRY_LATER: "OK",
  CHECK_CONNECTION: "",
};

export function ErrorPanel({
  error,
  details,
  onAction,
}: {
  error: ErrorInfo;
  details?: string[];
  onAction: (action: string) => void;
}) {
  const actions = error.actions.filter((a) => ACTION_LABELS[a]);
  return (
    <div role="alert" className="animate-fade-up rounded-2xl border border-line bg-surface p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-hot">{error.code.replace(/_/g, " ")}</p>
      <h2 className="mt-1 font-display text-3xl font-black uppercase leading-none">{error.title}</h2>
      <p className="mt-3 text-muted">{error.message}</p>
      {details && details.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-col gap-2">
        {actions.map((a, i) =>
          a === "PICK_ANOTHER_DANCE" ? (
            <Link key={a} href="/" className={btn(i === 0)}>
              {ACTION_LABELS[a]}
            </Link>
          ) : (
            <button key={a} type="button" onClick={() => onAction(a)} className={btn(i === 0)}>
              {ACTION_LABELS[a]}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function btn(primary: boolean) {
  return `pressable flex h-12 w-full items-center justify-center rounded-xl font-bold ${primary ? "bg-acid text-black" : "border border-line text-fg"}`;
}
