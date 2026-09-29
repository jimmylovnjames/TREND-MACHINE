"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-[80dvh] place-items-center px-6 text-center">
      <div>
        <p className="font-display text-4xl font-black uppercase">Something broke</p>
        <p className="mt-2 text-muted">An unexpected error happened on our side.</p>
        <button
          type="button"
          onClick={reset}
          className="pressable mt-6 h-12 rounded-xl bg-acid px-6 font-bold text-black"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
