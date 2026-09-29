"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type JobView } from "@/client/api";
import { forgetAllJobs } from "@/client/recent";
import { Wordmark } from "./Wordmark";

const STATUS_LABEL: Record<JobView["status"], string> = {
  QUEUED: "Queued",
  PROCESSING: "Rendering",
  COMPLETED: "Ready",
  FAILED: "Didn't work",
  CANCELED: "Canceled",
};

export function MyVideos() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api
      .jobs()
      .then((r) => {
        setJobs(r.jobs);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  const deleteAll = async () => {
    try {
      const { deleted } = await api.deleteAll();
      forgetAllJobs();
      setConfirming(false);
      setNotice(
        `Deleted ${deleted.uploads} photo(s), ${deleted.results} video(s) and ${deleted.shares} share link(s).`,
      );
      void load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-5 pt-[calc(var(--safe-top)+20px)]">
      <Wordmark className="text-xl" />
      <h1 className="mt-6 font-display text-5xl font-black uppercase leading-none">My videos</h1>
      <p className="mt-2 text-sm text-muted">Saved on this device only. Videos are kept for 30 days.</p>

      {error && <p className="mt-4 text-sm text-warn">{error}</p>}
      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-surface p-3 text-sm">
          {notice}
        </p>
      )}

      {jobs === null && !error && <div className="mt-6 h-40 animate-pulse rounded-2xl bg-surface" />}
      {jobs?.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-line p-6 text-center">
          <p className="text-muted">No videos yet.</p>
          <Link
            href="/"
            className="pressable mt-4 inline-flex h-12 items-center rounded-xl bg-acid px-6 font-bold text-black"
          >
            Pick a dance
          </Link>
        </div>
      )}

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {jobs?.map((j) => (
          <li key={j.id}>
            <Link
              href={`/g/${j.id}`}
              className="pressable block overflow-hidden rounded-2xl border border-line bg-surface"
            >
              <div className="relative aspect-[9/16] bg-surface-2">
                {j.result ? (
                  <video
                    src={j.result.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                    aria-hidden="true"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-4xl" aria-hidden="true">
                    {j.status === "FAILED" || j.status === "CANCELED" ? "✕" : "…"}
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="truncate font-display text-xl font-black uppercase leading-none">
                  {j.template.name}
                </p>
                <p
                  className={`mt-1 text-xs font-semibold ${j.status === "COMPLETED" && j.result ? "text-acid" : j.status === "FAILED" ? "text-hot" : "text-muted"}`}
                >
                  {j.status === "COMPLETED" && !j.result ? "Expired" : STATUS_LABEL[j.status]}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-12 rounded-2xl border border-line p-4" aria-labelledby="data-h">
        <h2 id="data-h" className="font-semibold">
          Your data
        </h2>
        <p className="mt-1 text-sm text-muted">
          Delete every photo, video and share link made on this device. This can&apos;t be undone.{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            Privacy &amp; retention
          </Link>
        </p>
        {confirming ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={deleteAll}
              className="pressable h-11 flex-1 rounded-xl bg-danger font-bold text-black"
            >
              Yes, delete everything
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="pressable h-11 flex-1 rounded-xl border border-line font-semibold"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="pressable mt-3 h-11 rounded-xl border border-danger/60 px-4 text-sm font-semibold text-danger"
          >
            Delete my data
          </button>
        )}
      </section>
    </main>
  );
}
