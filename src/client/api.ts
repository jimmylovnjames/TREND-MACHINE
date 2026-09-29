"use client";

import type { ReadinessBlocker, UserFacingError } from "@/domain/generation";
import type { PublicTemplate } from "@/domain/template";

export interface JobView {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELED";
  progress: number | null;
  error: UserFacingError | null;
  blockers: ReadinessBlocker[];
  template: { id: string; slug: string; name: string; version: number };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  regenerateOf: string | null;
  result: { url: string; downloadUrl: string; expiresAt: string | null } | null;
  aiGenerated: true;
}

export interface TemplateDetail {
  template: PublicTemplate;
  availability: { ready: boolean; blockers: ReadinessBlocker[] };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    message: string,
    readonly actions: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isNetwork() {
    return this.status === 0;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  let body: { error?: { code?: string; title?: string; message?: string; actions?: string[] } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  const e = body.error ?? {};
  throw new ApiError(
    res.status,
    e.code ?? `HTTP_${res.status}`,
    e.title ?? "Something went wrong",
    e.message ?? "Please try again.",
    e.actions ?? [],
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "NETWORK", "You're offline", "Check your connection and try again.", [
      "RETRY",
      "CHECK_CONNECTION",
    ]);
  }
  return parse<T>(res);
}

export const api = {
  template: (slug: string) => request<TemplateDetail>(`/api/templates/${encodeURIComponent(slug)}`),
  job: (id: string) => request<{ job: JobView }>(`/api/generations/${encodeURIComponent(id)}`),
  jobs: () => request<{ jobs: JobView[] }>("/api/generations"),
  createJob: (body: {
    templateSlug: string;
    uploadId?: string;
    idempotencyKey: string;
    rightsConfirmed: true;
    regenerateOf?: string;
  }) =>
    request<{ job: JobView }>("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  cancelJob: (id: string) =>
    request<{ job: JobView }>(`/api/generations/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  deleteJob: (id: string) =>
    request<{ deleted: true }>(`/api/generations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  share: (id: string) =>
    request<{ share: { slug: string; path: string } }>(`/api/generations/${encodeURIComponent(id)}/share`, {
      method: "POST",
    }),
  deleteAll: () =>
    request<{ deleted: { uploads: number; results: number; shares: number } }>("/api/me", {
      method: "DELETE",
    }),
};

/** Upload with progress (XHR — fetch has no upload progress). */
export function uploadPhoto(
  blob: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ id: string; expiresAt: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.setRequestHeader("Content-Type", blob.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: {
        upload?: { id: string; expiresAt: string };
        error?: { code: string; title: string; message: string; actions?: string[] };
      } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.upload) resolve(body.upload);
      else {
        const e = body.error;
        reject(
          new ApiError(
            xhr.status,
            e?.code ?? "UPLOAD_FAILED",
            e?.title ?? "Upload didn't finish",
            e?.message ?? "Please try again.",
            e?.actions ?? ["RETRY"],
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiError(
          0,
          "UPLOAD_FAILED",
          "Upload didn't finish",
          "Your photo didn't reach us. Check your connection and try again.",
          ["RETRY", "CHECK_CONNECTION"],
        ),
      );
    xhr.ontimeout = xhr.onerror;
    xhr.timeout = 120_000;
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(blob);
  });
}

export function newIdempotencyKey(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
