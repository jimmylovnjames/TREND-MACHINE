import "./_env";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { getDb } from "@/server/db";
import { registerReferenceAsset, ReferenceValidationError } from "@/server/reference";

/**
 * Register an OWNED reference-motion video with full provenance. The asset starts as
 * UPLOADED and cannot be used until approved with `npm run reference:approve`.
 *
 *   npm run reference:add -- --file glitch.mp4 --template tpl_glitch_walk \
 *     --creator "Dancer Name" --owner "TREND MACHINE Ltd" --method STUDIO_CAPTURE \
 *     --license "Work-for-hire; all rights assigned to TREND MACHINE" \
 *     --evidence "Signed performer release #2026-014" --captured 2026-10-02
 */
const { values } = parseArgs({
  options: {
    file: { type: "string" },
    template: { type: "string" },
    creator: { type: "string" },
    owner: { type: "string" },
    method: { type: "string" },
    license: { type: "string" },
    evidence: { type: "string" },
    captured: { type: "string" },
    notes: { type: "string" },
  },
});
if (!values.file) {
  console.error("--file is required");
  process.exit(2);
}
const db = await getDb();
try {
  const data = new Uint8Array(await readFile(values.file));
  const r = await registerReferenceAsset(db, data, {
    templateId: values.template ?? null,
    creator: values.creator ?? "",
    owner: values.owner ?? "",
    creationMethod: (values.method ?? "") as never,
    license: values.license ?? "",
    permissionEvidence: values.evidence ?? "",
    capturedOn: values.captured ?? null,
    notes: values.notes ?? "",
  });
  console.log(`registered reference asset ${r.id} (UPLOADED)`);
  console.log(
    `  ${r.info.width}x${r.info.height}, ${r.info.durationSeconds}s, fps=${r.info.fps ?? "?"}, audio=${r.info.hasAudio}`,
  );
  for (const w of r.warnings) console.log(`  warning: ${w}`);
  console.log(
    `next: review it, then run npm run reference:approve -- --id ${r.id} --reviewer "<name>" --confirm-all`,
  );
} catch (e) {
  if (e instanceof ReferenceValidationError || (e as Error).name === "ZodError") {
    console.error(`rejected: ${(e as Error).message}`);
    process.exitCode = 1;
  } else throw e;
} finally {
  await db.close();
}
