import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeParseTemplateSpec, type TemplateSpec } from "@/domain/template";
import { ContentValidationError, loadConceptSpecs, loadTemplateSpecs } from "@/server/content";
import { specHash } from "@/server/db/seed";

async function baseSpec(): Promise<TemplateSpec> {
  const specs = await loadTemplateSpecs();
  return structuredClone(specs.find((s) => s.slug === "glitch-walk")!);
}

describe("template content", () => {
  it("ships three valid original templates with pending reference motion", async () => {
    const specs = await loadTemplateSpecs();
    expect(specs.map((s) => s.slug).sort()).toEqual(["glitch-walk", "rubber-legs", "zero-gravity-shuffle"]);
    for (const s of specs) {
      expect(s.category).toBe("ORIGINAL");
      expect(s.media.previewVideoKey).toBeNull(); // no fabricated preview footage
      expect(s.rights.musicIncluded).toBe(false);
      expect(s.recipe.keepReferenceAudio).toBe(false);
      expect(s.recipe.capability).toBe("HUMAN_MOTION_TRANSFER");
    }
  });

  it("ships a dance-lab concept per template", async () => {
    const concepts = await loadConceptSpecs();
    expect(concepts.map((c) => c.templateId).sort()).toEqual([
      "tpl_glitch_walk",
      "tpl_rubber_legs",
      "tpl_zero_gravity_shuffle",
    ]);
  });

  it("rejects a fallback provider that is not in preferences", async () => {
    const s = await baseSpec();
    s.fallbackProviderId = "nope";
    const r = safeParseTemplateSpec(s);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("fallbackProviderId");
  });

  it("rejects bundled music without a licensed track", async () => {
    const s = await baseSpec();
    s.rights.musicIncluded = true;
    expect(safeParseTemplateSpec(s).success).toBe(false);
  });

  it("rejects keeping reference audio", async () => {
    const s = (await baseSpec()) as unknown as { recipe: { keepReferenceAudio: boolean } };
    s.recipe.keepReferenceAudio = true;
    expect(safeParseTemplateSpec(s).success).toBe(false);
  });

  it("rejects out-of-order or out-of-range movement phases", async () => {
    const s = await baseSpec();
    s.movement.sequence = [
      { at: 2, name: "b", description: "x" },
      { at: 1, name: "a", description: "y" },
    ];
    expect(safeParseTemplateSpec(s).success).toBe(false);
    const s2 = await baseSpec();
    s2.movement.sequence.push({ at: 99, name: "late", description: "z" });
    expect(safeParseTemplateSpec(s2).success).toBe(false);
  });

  it("rejects bad slugs, ids and levels", async () => {
    for (const mutate of [
      (s: TemplateSpec) => (s.slug = "Bad Slug"),
      (s: TemplateSpec) => (s.id = "glitch"),
      (s: TemplateSpec) => (s.energy = 9),
      (s: TemplateSpec) => (s.providerPreferences = []),
    ]) {
      const s = await baseSpec();
      mutate(s);
      expect(safeParseTemplateSpec(s).success).toBe(false);
    }
  });

  it("requires file name to match slug and reports all problems", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tm-tpl-"));
    const s = await baseSpec();
    writeFileSync(path.join(dir, "wrong-name.json"), JSON.stringify(s));
    await expect(loadTemplateSpecs(dir)).rejects.toBeInstanceOf(ContentValidationError);
  });

  it("version hash changes with spec and with reference asset, not with key order", async () => {
    const s = await baseSpec();
    const h1 = specHash(s, null);
    const reordered = Object.fromEntries(Object.entries(s).reverse()) as TemplateSpec;
    expect(specHash(reordered, null)).toBe(h1);
    expect(specHash(s, "11111111-1111-1111-1111-111111111111")).not.toBe(h1);
    s.hook = "different";
    expect(specHash(s, null)).not.toBe(h1);
  });
});
