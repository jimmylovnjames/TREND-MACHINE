"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type JobView } from "@/client/api";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELED"]);

/**
 * Poll a job until it is terminal. Pauses while the tab is hidden or offline,
 * backs off on errors, and resumes instantly on focus/reconnect. The server is the
 * source of truth, so refreshing or reopening the page picks up where it left off.
 */
export function usePolledJob(id: string) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notFound, setNotFound] = useState(false);
  const pollNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let current: JobView | null = null;
    let disposed = false;

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void tick(), ms);
    };

    async function tick() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (disposed || document.visibilityState === "hidden" || !navigator.onLine) return;
      try {
        const { job: j } = await api.job(id);
        if (disposed) return;
        failures = 0;
        current = j;
        setJob(j);
        setError(null);
        if (!TERMINAL.has(j.status)) schedule(j.status === "QUEUED" ? 3000 : 4000);
      } catch (e) {
        if (disposed) return;
        const err = e instanceof ApiError ? e : new ApiError(0, "NETWORK", "Connection problem", "Retrying…");
        if (err.status === 404) {
          setNotFound(true);
          return;
        }
        failures++;
        setError(err);
        schedule(Math.min(30_000, 2000 * 2 ** failures));
      }
    }

    const resume = () => {
      if (!current || !TERMINAL.has(current.status)) void tick();
    };
    pollNow.current = () => void tick();
    void tick();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [id]);

  const refresh = useCallback(() => pollNow.current(), []);
  return { job, error, notFound, refresh, setJob };
}
