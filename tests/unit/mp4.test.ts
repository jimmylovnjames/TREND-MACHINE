import { describe, expect, it } from "vitest";
import { assessVideo } from "@/server/reference";
import { inspectMp4, Mp4ParseError } from "@/server/uploads/mp4";
import { makeMp4 } from "../helpers/mp4";

describe("mp4 inspection", () => {
  it("reads duration, size, fps and audio", () => {
    const info = inspectMp4(makeMp4({ width: 1080, height: 1920, seconds: 7, fps: 30, audio: true }));
    expect(info).toEqual({ durationSeconds: 7, width: 1080, height: 1920, fps: 30, hasAudio: true });
  });

  it("applies rotation matrices to display dimensions", () => {
    const info = inspectMp4(makeMp4({ width: 1920, height: 1080, rotate90: true }));
    expect([info.width, info.height]).toEqual([1080, 1920]);
  });

  it("rejects non-mp4 data", () => {
    expect(() => inspectMp4(Buffer.from("hello world, definitely not a video"))).toThrow(Mp4ParseError);
  });

  it("assesses reference suitability", () => {
    expect(assessVideo(inspectMp4(makeMp4({ seconds: 2 })), 1000).errors[0]).toMatch(/below/);
    expect(assessVideo(inspectMp4(makeMp4({ seconds: 40 })), 1000).errors[0]).toMatch(/exceeds/);
    const w = assessVideo(
      inspectMp4(makeMp4({ width: 1920, height: 1080, audio: true })),
      1000,
    ).warnings.join(" ");
    expect(w).toMatch(/portrait/);
    expect(w).toMatch(/audio/);
    expect(assessVideo(inspectMp4(makeMp4()), 1000)).toEqual({ errors: [], warnings: [] });
  });
});
