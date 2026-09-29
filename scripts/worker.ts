import "./_env";
import { getDb } from "@/server/db";
import { advanceActiveJobs } from "@/server/generation/service";
import { runRetention } from "@/server/retention";

/**
 * Long-running background worker for self-hosted deployments (alternative to calling
 * /api/cron/tick from a scheduler). Advances jobs nobody is watching and enforces retention.
 */
const db = await getDb();
let stop = false;
process.on("SIGINT", () => (stop = true));
process.on("SIGTERM", () => (stop = true));
let lastRetention = 0;
console.log("[worker] started");
while (!stop) {
  try {
    const { checked } = await advanceActiveJobs(25, db);
    if (checked) console.log(`[worker] advanced ${checked} job(s)`);
    if (Date.now() - lastRetention > 10 * 60_000) {
      const r = await runRetention(db);
      lastRetention = Date.now();
      if (r.sources || r.results)
        console.log(`[worker] retention: ${r.sources} photo(s), ${r.results} video(s) deleted`);
    }
  } catch (e) {
    console.error("[worker] tick failed", e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
await db.close();
console.log("[worker] stopped");
