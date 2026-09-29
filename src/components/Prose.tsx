import Link from "next/link";
import { Wordmark } from "./Wordmark";

export function ProsePage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-5 pt-[calc(var(--safe-top)+20px)]">
      <Link href="/" aria-label="Home">
        <Wordmark className="text-xl" />
      </Link>
      <h1 className="mt-6 font-display text-5xl font-black uppercase leading-none">{title}</h1>
      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-muted [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-black [&_h2]:uppercase [&_h2]:text-fg [&_strong]:text-fg [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </main>
  );
}
