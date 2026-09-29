import { describe, expect, it } from "vitest";
import {
  allowedSources,
  assertTransition,
  canTransition,
  GENERATION_ERROR_CODES,
  InvalidTransitionError,
  JOB_STATUSES,
  TERMINAL_STATUSES,
  userFacingError,
} from "@/domain/generation";
import { flowReducer, initialFlow, type FlowState } from "@/client/flow";

describe("server job state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("QUEUED", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "COMPLETED")).toBe(true);
  });

  it("never leaves a terminal state", () => {
    for (const t of TERMINAL_STATUSES) for (const s of JOB_STATUSES) expect(canTransition(t, s)).toBe(false);
  });

  it("forbids going backwards", () => {
    expect(canTransition("PROCESSING", "QUEUED")).toBe(false);
    expect(() => assertTransition("COMPLETED", "FAILED")).toThrow(InvalidTransitionError);
  });

  it("computes source states for atomic updates", () => {
    expect(allowedSources("COMPLETED").sort()).toEqual(["PROCESSING", "QUEUED"]);
    expect(allowedSources("QUEUED")).toEqual([]);
  });

  it("has safe user-facing copy for every error code", () => {
    for (const code of GENERATION_ERROR_CODES) {
      const u = userFacingError(code);
      expect(u.title.length).toBeGreaterThan(3);
      expect(u.actions.length).toBeGreaterThan(0);
      // No vendor names, HTTP codes or model jargon leak to users.
      expect(`${u.title} ${u.message}`).not.toMatch(
        /higgsfield|viggle|kling|http|\b[45]\d\d\b|api key|model/i,
      );
    }
  });
});

describe("client flow state machine", () => {
  const run = (...events: Parameters<typeof flowReducer>[1][]) =>
    events.reduce<FlowState>(flowReducer, initialFlow);
  const err = { code: "X", title: "t", message: "m", actions: ["RETRY"] };

  it("walks IDLE → VALIDATING → UPLOADING → QUEUED → PROCESSING → COMPLETED", () => {
    let s = run({ type: "START" });
    expect(s.phase).toBe("VALIDATING");
    s = flowReducer(s, { type: "VALID" });
    expect(s.phase).toBe("UPLOADING");
    s = flowReducer(s, { type: "UPLOAD_PROGRESS", fraction: 0.5 });
    expect(s.uploadProgress).toBe(0.5);
    s = flowReducer(s, { type: "UPLOADED", uploadId: "u" });
    s = flowReducer(s, { type: "JOB", jobId: "j", status: "QUEUED" });
    expect(s.phase).toBe("QUEUED");
    s = flowReducer(s, { type: "JOB", jobId: "j", status: "PROCESSING" });
    s = flowReducer(s, { type: "JOB", jobId: "j", status: "QUEUED" }); // stale response
    expect(s.phase).toBe("PROCESSING");
    s = flowReducer(s, { type: "JOB", jobId: "j", status: "COMPLETED" });
    expect(s.phase).toBe("COMPLETED");
    expect(flowReducer(s, { type: "JOB", jobId: "j", status: "FAILED" }).phase).toBe("COMPLETED");
  });

  it("fails cleanly at each stage and can restart", () => {
    expect(run({ type: "START" }, { type: "INVALID", error: err }).phase).toBe("FAILED");
    const up = run({ type: "START" }, { type: "VALID" }, { type: "UPLOAD_FAILED", error: err });
    expect(up.phase).toBe("FAILED");
    expect(up.error).toEqual(err);
    expect(flowReducer(up, { type: "START" }).phase).toBe("VALIDATING");
  });

  it("ignores out-of-order events", () => {
    expect(run({ type: "VALID" }).phase).toBe("IDLE");
    expect(run({ type: "UPLOADED", uploadId: "x" }).uploadId).toBeNull();
    const s = run(
      { type: "START" },
      { type: "VALID" },
      { type: "UPLOAD_PROGRESS", fraction: 0.8 },
      { type: "UPLOAD_PROGRESS", fraction: 0.3 },
    );
    expect(s.uploadProgress).toBe(0.8);
  });
});
