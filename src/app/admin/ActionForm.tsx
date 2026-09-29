"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";

export function ActionForm({
  action,
  children,
  className = "",
  submitLabel,
  danger = false,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  submitLabel: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={`space-y-2 ${className}`}>
      {children}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`h-10 rounded-lg px-4 text-sm font-bold disabled:opacity-50 ${danger ? "border border-danger text-danger" : "bg-acid text-black"}`}
        >
          {pending ? "…" : submitLabel}
        </button>
        {state && (
          <span role="status" className={`text-sm ${state.ok ? "text-acid" : "text-danger"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

export const inputCls = "h-10 w-full rounded-lg border border-line bg-ink px-3 text-sm";
export const areaCls = "w-full rounded-lg border border-line bg-ink p-3 text-sm";
