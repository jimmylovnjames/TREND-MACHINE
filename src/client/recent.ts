"use client";

/** Local list of this browser's recent job ids — a convenience index only; the server is the source of truth. */
const KEY = "tm_recent_jobs";

export function rememberJob(id: string) {
  try {
    const list = recentJobs().filter((x) => x !== id);
    list.unshift(id);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* storage unavailable */
  }
}

export function recentJobs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function forgetAllJobs() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
