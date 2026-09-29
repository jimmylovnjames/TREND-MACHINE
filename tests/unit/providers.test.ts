import { afterEach, describe, expect, it, vi } from "vitest";
import { HiggsfieldProvider } from "@/server/providers/higgsfield";
import { ProviderError, type GenerationRequest } from "@/server/providers/types";
import { ViggleProvider } from "@/server/providers/viggle";

const REQ_ID = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";

function req(model: string): GenerationRequest {
  return {
    jobId: "00000000-0000-0000-0000-000000000001",
    model,
    capability: "HUMAN_MOTION_TRANSFER",
    image: { data: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", filename: "photo.jpg" },
    referenceVideo: {
      data: new Uint8Array([4, 5, 6]),
      contentType: "video/mp4",
      filename: "ref.mp4",
      durationSeconds: 7,
    },
    prompt: "scene",
    characterOrientation: "video",
    keepReferenceAudio: false,
    config: {},
  };
}

type Call = { url: string; init: RequestInit };
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  });
  return calls;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Higgsfield provider", () => {
  const hf = () =>
    new HiggsfieldProvider({
      keyId: "KID",
      keySecret: "KSECRET",
      baseUrl: "https://api.higgsfield.ai",
      timeoutMs: 5000,
    });

  it("reports not configured without credentials and fails with PROVIDER_NOT_CONFIGURED", async () => {
    const p = new HiggsfieldProvider({ baseUrl: "https://api.higgsfield.ai", timeoutMs: 5000 });
    expect(await p.isConfigured()).toBe(false);
    const calls = mockFetch(() => json({}));
    await expect(p.createJob(req("kling-video/v3/motion-control/std"))).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
    expect(calls).toHaveLength(0);
  });

  it("uploads inputs via presigned URLs, estimates cost, then submits with audio dropped", async () => {
    let n = 0;
    const calls = mockFetch((url) => {
      if (url.endsWith("/files/generate-upload-url")) {
        n++;
        return json({
          public_url: `https://cdn.hf.test/in${n}`,
          upload_url: `https://s3.hf.test/put${n}`,
          upload_headers: { "Content-Type": "x", "x-amz-tagging": "retention=temporary" },
        });
      }
      if (url.startsWith("https://s3.hf.test/")) return new Response(null, { status: 200 });
      if (url.includes("/estimate/")) return json({ credits: "10", usd: "0.625" });
      if (url.includes("/kling-video/v3/motion-control/std"))
        return json({ status: "queued", request_id: REQ_ID });
      return json({ detail: "unexpected" }, 500);
    });
    const sub = await hf().createJob(req("kling-video/v3/motion-control/std"));
    expect(sub).toEqual({
      providerJobId: REQ_ID,
      state: "QUEUED",
      cost: { usd: 0.625, source: "PROVIDER_ESTIMATE" },
    });

    const submit = calls.find(
      (c) => c.url === "https://api.higgsfield.ai/kling-video/v3/motion-control/std",
    )!;
    expect((submit.init.headers as Record<string, string>).Authorization).toBe("Key KID:KSECRET");
    expect(JSON.parse(String(submit.init.body))).toEqual({
      image_url: "https://cdn.hf.test/in1",
      video_url: "https://cdn.hf.test/in2",
      prompt: "scene",
      keep_original_sound: "no",
      character_orientation: "video",
    });
    // Credentials are never sent to the presigned storage URLs.
    for (const c of calls.filter((c) => c.url.startsWith("https://s3.hf.test/"))) {
      expect(JSON.stringify(c.init.headers)).not.toContain("KSECRET");
      expect((c.init.headers as Record<string, string>)["x-amz-tagging"]).toBe("retention=temporary");
    }
  });

  it("refuses unknown model ids (no path injection)", async () => {
    mockFetch(() => json({}));
    await expect(hf().createJob(req("../../admin"))).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("treats a submission network failure as ambiguous (never auto-resubmit)", async () => {
    mockFetch((url) => {
      if (url.endsWith("/files/generate-upload-url"))
        return json({ public_url: "https://cdn/x", upload_url: "https://s3.hf.test/p", upload_headers: {} });
      if (url.startsWith("https://s3.hf.test/")) return new Response(null, { status: 200 });
      if (url.includes("/estimate/")) return json({}, 404);
      throw new TypeError("fetch failed");
    });
    const err = await hf()
      .createJob(req("kling-video/v3/motion-control/std"))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.accepted).toBe("UNKNOWN");
    expect(err.retryable).toBe(false);
  });

  it("maps documented HTTP errors", async () => {
    const submitWith = async (status: number, detail: string) => {
      mockFetch((url) => {
        if (url.endsWith("/files/generate-upload-url"))
          return json({
            public_url: "https://cdn/x",
            upload_url: "https://s3.hf.test/p",
            upload_headers: {},
          });
        if (url.startsWith("https://s3.hf.test/")) return new Response(null, { status: 200 });
        if (url.includes("/estimate/")) return json({}, 500);
        return json({ detail }, status);
      });
      return hf()
        .createJob(req("kling-video/v3/motion-control/std"))
        .catch((e) => e as ProviderError);
    };
    expect(await submitWith(401, "Invalid credentials")).toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
      providerUnavailable: true,
    });
    expect(await submitWith(400, "Maximum number of concurrent requests (4) has been reached")).toMatchObject(
      { code: "PROVIDER_FAILED", retryable: true, accepted: "NO" },
    );
    expect(await submitWith(400, "Image rejected")).toMatchObject({ code: "PROVIDER_REJECTED" });
    expect(await submitWith(503, "disabled")).toMatchObject({
      code: "PROVIDER_FAILED",
      providerUnavailable: true,
    });
    expect(await submitWith(500, "boom")).toMatchObject({ code: "PROVIDER_FAILED", accepted: "UNKNOWN" });
  });

  it("maps request statuses", async () => {
    const statuses: Record<string, unknown> = {
      queued: { status: "queued", request_id: REQ_ID },
      in_progress: { status: "in_progress", request_id: REQ_ID },
      completed: { status: "completed", request_id: REQ_ID, video: { url: "https://cdn.hf.test/out.mp4" } },
      nsfw: { status: "nsfw", request_id: REQ_ID },
      failed: { status: "failed", request_id: REQ_ID, error: "Generation failed" },
    };
    for (const [k, body] of Object.entries(statuses)) {
      mockFetch((url) => {
        expect(url).toBe(`https://api.higgsfield.ai/requests/${REQ_ID}/status`);
        return json(body);
      });
      const s = await hf().getJob(REQ_ID);
      if (k === "queued") expect(s.state).toBe("QUEUED");
      if (k === "in_progress") expect(s.state).toBe("PROCESSING");
      if (k === "completed")
        expect(s).toMatchObject({ state: "COMPLETED", outputUrl: "https://cdn.hf.test/out.mp4" });
      if (k === "nsfw") expect(s).toMatchObject({ state: "FAILED", error: { code: "PROVIDER_REJECTED" } });
      if (k === "failed") expect(s).toMatchObject({ state: "FAILED", error: { code: "PROVIDER_FAILED" } });
    }
    await expect(hf().getJob("not-a-uuid")).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("extracts webhook job ids only when well-formed", () => {
    expect(hf().webhookJobId({ request_id: REQ_ID, status: "completed" })).toBe(REQ_ID);
    expect(hf().webhookJobId({ request_id: "../x" })).toBeNull();
    expect(hf().webhookJobId("junk")).toBeNull();
  });
});

describe("Viggle provider", () => {
  const vg = () => new ViggleProvider({ apiKey: "VKEY", baseUrl: "https://apis.viggle.ai", timeoutMs: 5000 });

  it("submits multipart with image + motion video and prices by duration", async () => {
    const calls = mockFetch(() => json({ id: "render_abc123", status: "queued", progress: 0 }));
    const sub = await vg().createJob(req("viggle/v1/render"));
    expect(sub).toEqual({
      providerJobId: "render_abc123",
      state: "QUEUED",
      cost: { usd: 0.07, source: "PRICE_TABLE" },
    });
    const c = calls[0]!;
    expect(c.url).toBe("https://apis.viggle.ai/v1/renders");
    expect((c.init.headers as Record<string, string>).Authorization).toBe("Bearer VKEY");
    const form = c.init.body as FormData;
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("motion_video")).toBeInstanceOf(Blob);
    expect(form.get("background_mode")).toBe("original");
  });

  it("maps error envelope codes", async () => {
    const cases: [number, string, object][] = [
      [401, "INVALID_CREDENTIAL", { code: "PROVIDER_NOT_CONFIGURED" }],
      [422, "NO_HUMANS_DETECTED", { code: "PROVIDER_REJECTED" }],
      [422, "CONTENT_POLICY_VIOLATION", { code: "PROVIDER_REJECTED" }],
      [429, "RATE_LIMITED", { code: "PROVIDER_FAILED", retryable: true }],
      [402, "INSUFFICIENT_CREDITS", { code: "PROVIDER_FAILED", providerUnavailable: true }],
      [500, "INTERNAL_ERROR", { code: "PROVIDER_FAILED", accepted: "UNKNOWN" }],
    ];
    for (const [status, code, expected] of cases) {
      mockFetch(() => json({ error: { code, message: "x", retryable: false } }, status));
      expect(
        await vg()
          .createJob(req("viggle/v1/render"))
          .catch((e) => e),
      ).toMatchObject(expected);
    }
  });

  it("maps video statuses and waits for the URL on ready", async () => {
    mockFetch(() =>
      json({
        id: "render_a",
        status: "ready",
        progress: 100,
        video_url: "https://assets.viggle.ai/a.mp4",
        error: null,
      }),
    );
    expect(await vg().getJob("render_a")).toMatchObject({
      state: "COMPLETED",
      outputUrl: "https://assets.viggle.ai/a.mp4",
    });
    mockFetch(() => json({ id: "render_a", status: "ready", progress: 100, video_url: null, error: null }));
    expect((await vg().getJob("render_a")).state).toBe("PROCESSING");
    mockFetch(() =>
      json({ id: "render_a", status: "failed", error: { code: "NO_HUMANS_DETECTED", message: "none" } }),
    );
    expect(await vg().getJob("render_a")).toMatchObject({
      state: "FAILED",
      error: { code: "PROVIDER_REJECTED" },
    });
  });

  it("cannot drop reference audio (so the router keeps it away from audio references)", () => {
    expect(vg().getCapabilities().canDropReferenceAudio).toBe(false);
  });
});
