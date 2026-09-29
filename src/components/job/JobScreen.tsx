"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/client/analytics";
import { api, ApiError, newIdempotencyKey, type JobView } from "@/client/api";
import { rememberJob } from "@/client/recent";
import { ErrorPanel } from "@/components/ErrorPanel";
import { usePolledJob } from "./usePolledJob";

export function JobScreen({ id }: { id: string }) {
  const { job, error, notFound, refresh, setJob } = usePolledJob(id);
  useEffect(() => rememberJob(id), [id]);

  if (notFound) {
    return (
      <Shell>
        <div className="mt-10 rounded-2xl border border-line p-6">
          <h1 className="font-display text-4xl font-black uppercase">Video not found</h1>
          <p className="mt-2 text-muted">It may have been deleted, expired, or made on another device.</p>
          <Link
            href="/"
            className="pressable mt-5 flex h-12 items-center justify-center rounded-xl bg-acid font-bold text-black"
          >
            Pick a dance
          </Link>
        </div>
      </Shell>
    );
  }
  if (!job) {
    return (
      <Shell>
        <div
          className="mt-6 aspect-[9/16] w-full animate-pulse rounded-[var(--radius-card)] bg-surface"
          aria-label="Loading"
        />
        {error && <p className="mt-3 text-sm text-warn">{error.message}</p>}
      </Shell>
    );
  }
  if (job.status === "COMPLETED" && job.result) return <Result job={job} onExpired={refresh} />;
  if (job.status === "FAILED" || job.status === "CANCELED" || (job.status === "COMPLETED" && !job.result))
    return <Failed job={job} />;
  return <InProgress job={job} connectionIssue={error} onCanceled={(j) => setJob(j)} />;
}

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <main className="mx-auto max-w-lg px-5 pt-[calc(var(--safe-top)+12px)]">
      <header className="flex items-center gap-3">
        <Link
          href="/me"
          aria-label="My videos"
          className="pressable grid h-11 w-11 place-items-center rounded-full bg-surface text-xl"
        >
          <span aria-hidden="true">←</span>
        </Link>
        {title && <p className="truncate font-display text-2xl font-black uppercase">{title}</p>}
      </header>
      {children}
    </main>
  );
}

function useElapsed(since: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function InProgress({
  job,
  connectionIssue,
  onCanceled,
}: {
  job: JobView;
  connectionIssue: ApiError | null;
  onCanceled: (j: JobView) => void;
}) {
  const elapsed = useElapsed(job.createdAt);
  const [canceling, setCanceling] = useState(false);
  const label = job.status === "QUEUED" ? "In the queue" : "Rendering your moves";
  return (
    <Shell title={job.template.name}>
      <div className="relative mt-5 aspect-[9/16] w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex h-24 items-end gap-2" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-3 origin-bottom rounded-full bg-acid"
                style={{
                  height: "100%",
                  animation: `eq ${0.9 + i * 0.13}s ease-in-out ${i * 0.1}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
        <div
          className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-acid/10 to-transparent"
          style={{ animation: "scan 2.4s linear infinite" }}
          aria-hidden="true"
        />
        <div className="absolute inset-x-0 bottom-0 p-5" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-wider text-acid">{label}</p>
          <p className="mt-1 font-display text-4xl font-black uppercase leading-none">Making your video</p>
          {job.progress !== null && job.progress > 0 && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-acid transition-[width]" style={{ width: `${job.progress}%` }} />
            </div>
          )}
          <p className="mt-2 font-mono text-sm text-muted">{elapsed}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted">
        This usually takes a few minutes. You can leave — your video keeps rendering and will be waiting in{" "}
        <Link href="/me" className="font-semibold text-fg underline underline-offset-2">
          My videos
        </Link>
        .
      </p>
      {connectionIssue && <p className="mt-2 text-sm text-warn">Connection problem — still trying…</p>}
      <button
        type="button"
        disabled={canceling}
        onClick={async () => {
          setCanceling(true);
          try {
            onCanceled((await api.cancelJob(job.id)).job);
          } finally {
            setCanceling(false);
          }
        }}
        className="pressable mt-6 h-11 w-full rounded-xl border border-line text-sm font-semibold text-muted"
      >
        {canceling ? "Canceling…" : "Cancel"}
      </button>
    </Shell>
  );
}

function useRegenerate(job: JobView) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const key = useRef<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    key.current ??= newIdempotencyKey();
    trackEvent("regenerate", {
      templateId: job.template.id,
      templateVersion: job.template.version,
      jobId: job.id,
      props: { surface: "result" },
    });
    try {
      const { job: next } = await api.createJob({
        templateSlug: job.template.slug,
        regenerateOf: job.id,
        idempotencyKey: key.current,
        rightsConfirmed: true,
      });
      rememberJob(next.id);
      router.push(`/g/${next.id}`);
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? e
          : new ApiError(0, "INTERNAL_ERROR", "Something went wrong", "Please try again."),
      );
      key.current = null;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, err };
}

function Failed({ job }: { job: JobView }) {
  const router = useRouter();
  const regen = useRegenerate(job);
  const canceled = job.status === "CANCELED";
  const error = canceled
    ? {
        code: "CANCELED",
        title: "Canceled",
        message: "You canceled this video.",
        actions: ["RETRY", "PICK_ANOTHER_DANCE"],
      }
    : (job.error ?? {
        code: "INTERNAL_ERROR",
        title: "Something went wrong",
        message: "Please try again.",
        actions: ["RETRY"],
      });
  const shown = regen.err
    ? {
        code: regen.err.code,
        title: regen.err.title,
        message: regen.err.message,
        actions: regen.err.actions.length ? regen.err.actions : ["TRY_LATER"],
      }
    : error;
  return (
    <Shell title={job.template.name}>
      <div className="mt-6">
        <ErrorPanel
          error={shown}
          details={
            regen.err
              ? undefined
              : job.blockers.filter((b) => b.code !== shown.code).map((b) => `Also needed: ${b.message}`)
          }
          onAction={(a) => {
            if (a === "RETRY") void regen.run();
            if (a === "CHANGE_PHOTO") router.push(`/d/${job.template.slug}/make`);
            if (a === "TRY_LATER") router.push("/");
          }}
        />
        {regen.busy && <p className="mt-3 text-sm text-muted">Starting a new take…</p>}
      </div>
    </Shell>
  );
}

function Result({ job, onExpired }: { job: JobView; onExpired: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const played = useRef(false);
  const reloads = useRef(0);
  const regen = useRegenerate(job);
  const [toast, setToast] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const router = useRouter();
  const ev = { templateId: job.template.id, templateVersion: job.template.version, jobId: job.id };
  const result = job.result!;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const share = async () => {
    setSharing(true);
    try {
      // 1) Native share of the video file itself (best on Android/iOS).
      try {
        const blob = await (await fetch(result.url)).blob();
        const file = new File([blob], `trend-machine-${job.template.slug}.mp4`, { type: "video/mp4" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: `${job.template.name} · TREND MACHINE` });
          trackEvent("share", { ...ev, props: { surface: "result", method: "native" } });
          return;
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
      // 2) Shareable link (result only — never the source photo).
      const { share: s } = await api.share(job.id);
      const url = `${location.origin}${s.path}`;
      if (navigator.share) {
        try {
          await navigator.share({ url, title: `${job.template.name} · TREND MACHINE` });
          trackEvent("share", { ...ev, props: { surface: "result", method: "native" } });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      setToast("Link copied");
      trackEvent("share", { ...ev, props: { surface: "result", method: "copy_link" } });
    } catch {
      setToast("Couldn't share right now");
    } finally {
      setSharing(false);
    }
  };

  return (
    <main className="mx-auto max-w-lg px-4 pt-[calc(var(--safe-top)+8px)]">
      <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-black">
        <video
          ref={video}
          src={result.url}
          className="aspect-[9/16] w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-label={`Your ${job.template.name} video`}
          onPlaying={() => {
            if (!played.current) {
              played.current = true;
              trackEvent("result_play", { ...ev, props: { surface: "result" } });
            }
          }}
          onError={() => {
            // Signed URLs expire; fetch fresh ones (bounded, in case the file itself is bad).
            if (reloads.current++ < 2) onExpired();
          }}
          onClick={() => (video.current?.paused ? video.current.play() : video.current?.pause())}
        />
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider backdrop-blur">
          AI-generated
        </span>
        <Link
          href="/me"
          aria-label="Close"
          className="pressable absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-black/60 backdrop-blur"
        >
          <span aria-hidden="true">✕</span>
        </Link>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-16">
          <p className="font-display text-4xl font-black uppercase leading-none">{job.template.name}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={share}
          disabled={sharing}
          className="pressable col-span-2 h-14 rounded-2xl bg-acid font-display text-2xl font-black uppercase text-black disabled:opacity-60"
        >
          {sharing ? "Opening…" : "Share"}
        </button>
        <a
          href={result.downloadUrl}
          download
          onClick={() => trackEvent("download", { ...ev, props: { surface: "result", method: "download" } })}
          className="pressable flex h-12 items-center justify-center rounded-2xl border border-line font-semibold"
        >
          Download
        </a>
        <button
          type="button"
          onClick={() => {
            if (video.current) {
              video.current.currentTime = 0;
              void video.current.play();
            }
          }}
          className="pressable h-12 rounded-2xl border border-line font-semibold"
        >
          Replay
        </button>
        <button
          type="button"
          onClick={() => void regen.run()}
          disabled={regen.busy}
          className="pressable col-span-2 h-12 rounded-2xl border border-line font-semibold disabled:opacity-60"
        >
          {regen.busy ? "Starting…" : "Regenerate"}
        </button>
      </div>
      {regen.err && (
        <p role="alert" className="mt-3 text-sm text-warn">
          {regen.err.message}{" "}
          {regen.err.code === "UPLOAD_FAILED" && (
            <button
              type="button"
              className="underline"
              onClick={() => router.push(`/d/${job.template.slug}/make`)}
            >
              Add photo again
            </button>
          )}
        </p>
      )}
      <p className="mt-4 text-center text-xs text-muted">
        {result.expiresAt ? `Saved until ${new Date(result.expiresAt).toLocaleDateString()}. ` : ""}Made with
        AI from your photo.
      </p>
      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[calc(var(--nav-h)+var(--safe-bottom)+16px)] z-50 mx-auto w-fit rounded-full bg-fg px-4 py-2 text-sm font-semibold text-ink"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
