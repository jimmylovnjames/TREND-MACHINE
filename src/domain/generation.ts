/**
 * Generation job domain: states, transitions and error vocabulary.
 *
 * Server-side job status is the source of truth. The client adds the
 * pre-submission phases (IDLE → VALIDATING → UPLOADING) on top of it.
 */

export const JOB_STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES: readonly JobStatus[] = ["COMPLETED", "FAILED", "CANCELED"];
export const ACTIVE_STATUSES: readonly JobStatus[] = ["QUEUED", "PROCESSING"];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Allowed server-side transitions. Terminal states never move. */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  QUEUED: ["PROCESSING", "COMPLETED", "FAILED", "CANCELED"],
  PROCESSING: ["COMPLETED", "FAILED", "CANCELED"],
  COMPLETED: [],
  FAILED: [],
  CANCELED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses from which `to` may be reached — used to build atomic `WHERE status = ANY(...)` updates. */
export function allowedSources(to: JobStatus): JobStatus[] {
  return JOB_STATUSES.filter((s) => TRANSITIONS[s].includes(to));
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Invalid job transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Client-visible flow phases (superset of server statuses). */
export const FLOW_PHASES = [
  "IDLE",
  "VALIDATING",
  "UPLOADING",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;
export type FlowPhase = (typeof FLOW_PHASES)[number];

export const GENERATION_ERROR_CODES = [
  "INVALID_INPUT",
  "UPLOAD_FAILED",
  "REFERENCE_MOTION_NOT_READY",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_REJECTED",
  "PROVIDER_FAILED",
  "TIMEOUT",
  "RATE_LIMITED",
  "RESULT_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;
export type GenerationErrorCode = (typeof GENERATION_ERROR_CODES)[number];

export function isGenerationErrorCode(v: unknown): v is GenerationErrorCode {
  return typeof v === "string" && (GENERATION_ERROR_CODES as readonly string[]).includes(v);
}

export type RecoveryAction =
  "RETRY" | "CHANGE_PHOTO" | "PICK_ANOTHER_DANCE" | "TRY_LATER" | "CHECK_CONNECTION";

export interface UserFacingError {
  code: GenerationErrorCode;
  title: string;
  message: string;
  actions: RecoveryAction[];
}

/**
 * User-facing copy per error code. Deliberately free of vendor names,
 * HTTP codes and internal detail — those stay in server logs / admin views.
 */
const USER_ERRORS: Record<GenerationErrorCode, Omit<UserFacingError, "code">> = {
  INVALID_INPUT: {
    title: "That photo can't be used",
    message: "We couldn't read this image. Try a clear JPEG, PNG or WebP photo showing one full body.",
    actions: ["CHANGE_PHOTO"],
  },
  UPLOAD_FAILED: {
    title: "Upload didn't finish",
    message: "Your photo didn't reach us. Check your connection and try again.",
    actions: ["RETRY", "CHECK_CONNECTION"],
  },
  REFERENCE_MOTION_NOT_READY: {
    title: "This dance isn't recorded yet",
    message:
      "The reference performance for this move hasn't been captured yet, so we can't make your video. Nothing was charged and your photo wasn't sent anywhere.",
    actions: ["PICK_ANOTHER_DANCE"],
  },
  PROVIDER_NOT_CONFIGURED: {
    title: "Video engine not connected",
    message:
      "TREND MACHINE's video engine isn't switched on in this environment yet, so no video could be generated. Your photo wasn't sent anywhere.",
    actions: ["TRY_LATER"],
  },
  PROVIDER_REJECTED: {
    title: "The photo was declined",
    message:
      "The video engine couldn't use this photo. Photos work best with one person, full body, head, arms and legs visible, and good light.",
    actions: ["CHANGE_PHOTO", "PICK_ANOTHER_DANCE"],
  },
  PROVIDER_FAILED: {
    title: "The video didn't render",
    message: "Something went wrong while making your video. You can try again.",
    actions: ["RETRY", "TRY_LATER"],
  },
  TIMEOUT: {
    title: "This is taking too long",
    message: "Your video didn't finish in time, so we stopped waiting. You can try again.",
    actions: ["RETRY", "TRY_LATER"],
  },
  RATE_LIMITED: {
    title: "Slow down a little",
    message: "You've made a lot of videos recently. Please wait a bit before making another.",
    actions: ["TRY_LATER"],
  },
  RESULT_UNAVAILABLE: {
    title: "Video unavailable",
    message: "This video is no longer available. It may have expired or been deleted.",
    actions: ["PICK_ANOTHER_DANCE"],
  },
  INTERNAL_ERROR: {
    title: "Something broke on our side",
    message: "An unexpected error happened. Please try again in a moment.",
    actions: ["RETRY", "TRY_LATER"],
  },
};

export function userFacingError(code: GenerationErrorCode): UserFacingError {
  return { code, ...USER_ERRORS[code] };
}

/** A blocker that prevents generation for a template in the current environment. */
export interface ReadinessBlocker {
  code: Extract<GenerationErrorCode, "REFERENCE_MOTION_NOT_READY" | "PROVIDER_NOT_CONFIGURED">;
  /** Public, non-sensitive explanation (safe to show users). */
  message: string;
}
