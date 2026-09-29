import "./_env";
import { parseArgs } from "node:util";
import { getDb } from "@/server/db";
import { approveReferenceAsset, ReferenceValidationError, SUITABILITY_CHECKS } from "@/server/reference";

/**
 * Approve a reference asset after human review. You must affirm every suitability check
 * (--confirm-all, or individually with --check single_performer --check ...).
 */
const { values } = parseArgs({
  options: {
    id: { type: "string" },
    reviewer: { type: "string" },
    "confirm-all": { type: "boolean", default: false },
    check: { type: "string", multiple: true },
  },
});
if (!values.id || !values.reviewer) {
  console.error(
    `usage: --id <asset-id> --reviewer <name> (--confirm-all | --check <${SUITABILITY_CHECKS.join("|")}> ...)`,
  );
  process.exit(2);
}
const checks = Object.fromEntries(
  SUITABILITY_CHECKS.map((c) => [c, values["confirm-all"] || (values.check ?? []).includes(c)]),
);
const db = await getDb();
try {
  const r = await approveReferenceAsset(db, values.id, values.reviewer, checks);
  console.log(`approved ${values.id}${r.templateVersion ? `; template now at v${r.templateVersion}` : ""}`);
} catch (e) {
  if (e instanceof ReferenceValidationError) {
    console.error(`not approved: ${e.message}`);
    process.exitCode = 1;
  } else throw e;
} finally {
  await db.close();
}
