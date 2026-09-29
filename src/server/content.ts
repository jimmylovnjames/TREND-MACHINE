import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { danceConceptSchema, type DanceConcept } from "@/domain/lab";
import { safeParseTemplateSpec, type TemplateSpec } from "@/domain/template";

export const CONTENT_DIR = path.join(process.cwd(), "content");

async function loadJsonDir(dir: string): Promise<{ file: string; data: unknown }[]> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return Promise.all(
    files.map(async (file) => ({
      file,
      data: JSON.parse(await readFile(path.join(dir, file), "utf8")) as unknown,
    })),
  );
}

export class ContentValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Content validation failed:\n${problems.join("\n")}`);
    this.name = "ContentValidationError";
  }
}

export async function loadTemplateSpecs(dir = path.join(CONTENT_DIR, "templates")): Promise<TemplateSpec[]> {
  const problems: string[] = [];
  const specs: TemplateSpec[] = [];
  for (const { file, data } of await loadJsonDir(dir)) {
    const r = safeParseTemplateSpec(data);
    if (!r.success) {
      problems.push(...r.error.issues.map((i) => `${file}: ${i.path.join(".")}: ${i.message}`));
      continue;
    }
    if (`${r.data.slug}.json` !== file) problems.push(`${file}: file name must match slug "${r.data.slug}"`);
    specs.push(r.data);
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const s of specs) {
    if (ids.has(s.id)) problems.push(`duplicate template id ${s.id}`);
    if (slugs.has(s.slug)) problems.push(`duplicate template slug ${s.slug}`);
    ids.add(s.id);
    slugs.add(s.slug);
  }
  if (problems.length) throw new ContentValidationError(problems);
  return specs;
}

export async function loadConceptSpecs(dir = path.join(CONTENT_DIR, "concepts")): Promise<DanceConcept[]> {
  const problems: string[] = [];
  const out: DanceConcept[] = [];
  for (const { file, data } of await loadJsonDir(dir)) {
    const r = danceConceptSchema.safeParse(data);
    if (!r.success) problems.push(...r.error.issues.map((i) => `${file}: ${i.path.join(".")}: ${i.message}`));
    else out.push(r.data);
  }
  if (problems.length) throw new ContentValidationError(problems);
  return out;
}
