import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[80dvh] place-items-center px-6 text-center">
      <div>
        <p className="font-display text-7xl font-black uppercase text-acid">404</p>
        <p className="mt-2 font-display text-3xl font-black uppercase">Missed a step</p>
        <p className="mt-2 text-muted">That page doesn&apos;t exist.</p>
        <Link
          href="/"
          className="pressable mt-6 inline-flex h-12 items-center rounded-xl bg-acid px-6 font-bold text-black"
        >
          Back to the moves
        </Link>
      </div>
    </main>
  );
}
