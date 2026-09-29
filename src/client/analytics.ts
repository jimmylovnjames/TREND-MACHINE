"use client";

import type { ClientEvent, ClientEventName } from "@/domain/analytics";

/**
 * Tiny batched analytics client. Pseudonymous: the server derives the anonymous id
 * from the device cookie. No PII, no free text, no URLs are ever sent.
 */

const queue: ClientEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const seenImpressions = new Set<string>();

function sessionId(): string {
  try {
    let id = sessionStorage.getItem("tm_sid");
    if (!id) {
      const b = new Uint8Array(12);
      crypto.getRandomValues(b);
      id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem("tm_sid", id);
    }
    return id;
  } catch {
    return "nosession";
  }
}

function flush(useBeacon = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const events = queue.splice(0, 50);
  const body = JSON.stringify({ events });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    return;
  }
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush(true));
}

export function trackEvent(
  name: ClientEventName,
  data: Omit<ClientEvent, "name" | "at" | "sessionId"> = {},
): void {
  if (typeof window === "undefined") return;
  queue.push({ name, at: Date.now(), sessionId: sessionId(), ...data });
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(() => flush(), 4000);
}

/** Record each template impression at most once per page session. */
export function trackImpression(
  templateId: string,
  templateVersion: number,
  section: NonNullable<ClientEvent["props"]>["section"],
  position: number,
) {
  const key = `${templateId}:${section}`;
  if (seenImpressions.has(key)) return;
  seenImpressions.add(key);
  trackEvent("template_impression", {
    templateId,
    templateVersion,
    props: { surface: "home", section, position },
  });
}
