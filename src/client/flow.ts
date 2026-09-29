import type { FlowPhase, JobStatus } from "@/domain/generation";

/**
 * Client generation-flow state machine (pure, unit tested).
 *
 *  IDLE → VALIDATING → UPLOADING → QUEUED → PROCESSING → COMPLETED
 *                   ↘        ↘         ↘          ↘
 *                                 FAILED
 */
export interface FlowError {
  code: string;
  title: string;
  message: string;
  actions: string[];
}

export interface FlowState {
  phase: FlowPhase;
  uploadProgress: number;
  uploadId: string | null;
  jobId: string | null;
  error: FlowError | null;
}

export type FlowEvent =
  | { type: "START" }
  | { type: "VALID" }
  | { type: "INVALID"; error: FlowError }
  | { type: "UPLOAD_PROGRESS"; fraction: number }
  | { type: "UPLOADED"; uploadId: string }
  | { type: "UPLOAD_FAILED"; error: FlowError }
  | { type: "JOB"; jobId: string; status: JobStatus; error?: FlowError | null }
  | { type: "REQUEST_FAILED"; error: FlowError }
  | { type: "RESET" };

export const initialFlow: FlowState = {
  phase: "IDLE",
  uploadProgress: 0,
  uploadId: null,
  jobId: null,
  error: null,
};

export function flowReducer(state: FlowState, ev: FlowEvent): FlowState {
  switch (ev.type) {
    case "RESET":
      return initialFlow;
    case "START":
      if (state.phase !== "IDLE" && state.phase !== "FAILED") return state;
      return { ...initialFlow, phase: "VALIDATING" };
    case "VALID":
      return state.phase === "VALIDATING" ? { ...state, phase: "UPLOADING", uploadProgress: 0 } : state;
    case "INVALID":
      return state.phase === "VALIDATING" ? { ...state, phase: "FAILED", error: ev.error } : state;
    case "UPLOAD_PROGRESS":
      return state.phase === "UPLOADING"
        ? { ...state, uploadProgress: Math.max(state.uploadProgress, Math.min(1, ev.fraction)) }
        : state;
    case "UPLOADED":
      return state.phase === "UPLOADING" ? { ...state, uploadId: ev.uploadId, uploadProgress: 1 } : state;
    case "UPLOAD_FAILED":
      return state.phase === "UPLOADING" ? { ...state, phase: "FAILED", error: ev.error } : state;
    case "REQUEST_FAILED":
      return state.phase === "UPLOADING" || state.phase === "QUEUED"
        ? { ...state, phase: "FAILED", error: ev.error }
        : state;
    case "JOB": {
      if (state.phase === "IDLE" || state.phase === "VALIDATING" || state.phase === "COMPLETED") return state;
      const phase: FlowPhase =
        ev.status === "COMPLETED"
          ? "COMPLETED"
          : ev.status === "FAILED" || ev.status === "CANCELED"
            ? "FAILED"
            : ev.status;
      // Never move backwards from PROCESSING to QUEUED on a stale response.
      if (state.phase === "PROCESSING" && phase === "QUEUED") return { ...state, jobId: ev.jobId };
      return {
        ...state,
        phase,
        jobId: ev.jobId,
        error: phase === "FAILED" ? (ev.error ?? state.error) : null,
      };
    }
  }
}
