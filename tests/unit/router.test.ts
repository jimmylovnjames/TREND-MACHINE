import { describe, expect, it } from "vitest";
import { loadTemplateSpecs } from "@/server/content";
import { HiggsfieldProvider } from "@/server/providers/higgsfield";
import { routeGeneration, type RegisteredProvider } from "@/server/providers/router";
import { ViggleProvider } from "@/server/providers/viggle";

const hf = new HiggsfieldProvider({
  keyId: "id",
  keySecret: "secret",
  baseUrl: "https://api.higgsfield.ai",
  timeoutMs: 1000,
});
const vg = new ViggleProvider({ apiKey: "k", baseUrl: "https://apis.viggle.ai", timeoutMs: 1000 });
const both = (hfOn = true, vgOn = true): RegisteredProvider[] => [
  { provider: hf, configured: hfOn },
  { provider: vg, configured: vgOn },
];
const silentRef = { durationSeconds: 7, bytes: 5e6, hasAudio: false };

async function spec() {
  return (await loadTemplateSpecs()).find((s) => s.slug === "glitch-walk")!;
}

describe("model router", () => {
  it("prefers the template's primary provider and matching tier", async () => {
    const r = routeGeneration(await spec(), both(), { tier: "standard", reference: silentRef });
    expect(r.blocker).toBeNull();
    expect(r.candidates[0]).toMatchObject({
      providerId: "higgsfield",
      model: "kling-video/v3/motion-control/std",
    });
    expect(r.candidates.at(-1)).toMatchObject({ providerId: "viggle", isFallback: true });
  });

  it("promotes the pro model when the pro tier is requested", async () => {
    const r = routeGeneration(await spec(), both(), { tier: "pro", reference: silentRef });
    expect(r.candidates[0]!.model).toBe("kling-video/v3/motion-control/pro");
  });

  it("returns PROVIDER_NOT_CONFIGURED when nothing has credentials", async () => {
    const r = routeGeneration(await spec(), both(false, false), { tier: "standard", reference: silentRef });
    expect(r.candidates).toHaveLength(0);
    expect(r.blocker).toBe("PROVIDER_NOT_CONFIGURED");
    expect(new Set(r.rejected.map((x) => x.reason))).toEqual(new Set(["NOT_CONFIGURED"]));
  });

  it("falls back to the fallback provider when the primary is unconfigured", async () => {
    const r = routeGeneration(await spec(), both(false, true), { tier: "standard", reference: silentRef });
    expect(r.candidates.map((c) => c.providerId)).toEqual(["viggle"]);
  });

  it("skips providers with an open circuit", async () => {
    const r = routeGeneration(await spec(), both(), {
      tier: "standard",
      reference: silentRef,
      health: { higgsfield: { unavailableUntil: new Date(Date.now() + 60_000) } },
    });
    expect(r.candidates.map((c) => c.providerId)).toEqual(["viggle"]);
    expect(r.rejected.some((x) => x.reason === "UNHEALTHY")).toBe(true);
  });

  it("never routes to a provider that can't drop reference audio when the reference has audio", async () => {
    const r = routeGeneration(await spec(), both(), {
      tier: "standard",
      reference: { ...silentRef, hasAudio: true },
    });
    expect(r.candidates.every((c) => c.providerId === "higgsfield")).toBe(true);
    expect(r.rejected).toContainEqual(
      expect.objectContaining({ providerId: "viggle", reason: "REFERENCE_AUDIO_NOT_DROPPABLE" }),
    );
  });

  it("reports REFERENCE_MOTION_NOT_READY when the reference violates every provider's constraints", async () => {
    const r = routeGeneration(await spec(), both(), {
      tier: "standard",
      reference: { ...silentRef, durationSeconds: 45 },
    });
    expect(r.blocker).toBe("REFERENCE_MOTION_NOT_READY");
  });

  it("rejects unknown models and unsupported capabilities", async () => {
    const s = await spec();
    const r = routeGeneration(
      {
        ...s,
        providerPreferences: [{ providerId: "higgsfield", model: "made-up", priority: 0 }],
        fallbackProviderId: null,
      },
      both(),
      { tier: "standard", reference: silentRef },
    );
    expect(r.rejected[0]!.reason).toBe("MODEL_UNKNOWN");
    const r2 = routeGeneration({ ...s, recipe: { ...s.recipe, capability: "PET_ANIMATION" } }, both(), {
      tier: "standard",
      reference: silentRef,
    });
    expect(r2.candidates).toHaveLength(0);
    expect(r2.rejected.every((x) => x.reason === "CAPABILITY_UNSUPPORTED")).toBe(true);
  });

  it("uses measured success rate only with enough observations", async () => {
    const s = await spec();
    const few = routeGeneration(s, both(), {
      tier: "standard",
      reference: silentRef,
      health: { higgsfield: { n: 3, successRate: 0 } },
    });
    const many = routeGeneration(s, both(), {
      tier: "standard",
      reference: silentRef,
      health: { higgsfield: { n: 100, successRate: 0.2 } },
    });
    expect(many.candidates[0]!.score).toBeLessThan(few.candidates[0]!.score);
  });
});
