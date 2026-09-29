import "server-only";
import type { Db } from "./db";
import { pruneRateLimits } from "./ratelimit";
import { getStorage } from "./storage";

/**
 * Retention policy enforcement (run from cron / `npm run cleanup`):
 *  - source photos: deleted SOURCE_RETENTION_HOURS after upload (default 24h)
 *  - generated videos: deleted RESULT_RETENTION_DAYS after completion (default 30d)
 *  - share links die with their video
 */
export async function runRetention(db: Db): Promise<{ sources: number; results: number }> {
  const storage = getStorage();
  let sources = 0;
  let results = 0;

  const expiredUploads = await db.query<{ id: string; storage_key: string }>(
    `select u.id, u.storage_key from uploads u
     where u.deleted_at is null and u.expires_at < now()
       and not exists (select 1 from generation_jobs j where j.upload_id = u.id and j.status in ('QUEUED','PROCESSING'))
     limit 500`,
  );
  for (const u of expiredUploads) {
    await storage.delete(u.storage_key);
    await db.query("update uploads set deleted_at = now() where id = $1", [u.id]);
    sources++;
  }

  const expiredResults = await db.query<{ id: string; result_storage_key: string }>(
    `select id, result_storage_key from generation_jobs
     where result_storage_key is not null and result_deleted_at is null and result_expires_at < now() limit 500`,
  );
  for (const j of expiredResults) {
    await storage.delete(j.result_storage_key);
    await db.query("update generation_jobs set result_deleted_at = now() where id = $1", [j.id]);
    await db.query("update shares set revoked_at = now() where job_id = $1 and revoked_at is null", [j.id]);
    results++;
  }
  await pruneRateLimits(db);
  return { sources, results };
}

/** Delete everything tied to one anonymous device (user-initiated deletion request). */
export async function deleteDeviceData(
  db: Db,
  ownerHash: string,
): Promise<{ uploads: number; results: number; shares: number }> {
  const storage = getStorage();
  const [req] = await db.query<{ id: string }>(
    "insert into data_deletions (owner_hash) values ($1) returning id",
    [ownerHash],
  );
  const uploads = await db.query<{ id: string; storage_key: string }>(
    "select id, storage_key from uploads where owner_hash = $1 and deleted_at is null",
    [ownerHash],
  );
  for (const u of uploads) {
    await storage.delete(u.storage_key);
    await db.query("update uploads set deleted_at = now() where id = $1", [u.id]);
  }
  const jobs = await db.query<{ id: string; result_storage_key: string | null }>(
    "select id, result_storage_key from generation_jobs where owner_hash = $1 and result_storage_key is not null and result_deleted_at is null",
    [ownerHash],
  );
  for (const j of jobs) {
    if (j.result_storage_key) await storage.delete(j.result_storage_key);
    await db.query("update generation_jobs set result_deleted_at = now() where id = $1", [j.id]);
  }
  const shares = await db.query<{ id: string }>(
    "update shares set revoked_at = now() where owner_hash = $1 and revoked_at is null returning id",
    [ownerHash],
  );
  const summary = { uploads: uploads.length, results: jobs.length, shares: shares.length };
  await db.query("update data_deletions set completed_at = now(), summary = $2 where id = $1", [
    req!.id,
    JSON.stringify(summary),
  ]);
  return summary;
}

/** Delete a single generation's media (result video, its source photo, share links). */
export async function deleteJobMedia(db: Db, jobId: string, ownerHash: string): Promise<boolean> {
  const storage = getStorage();
  const [job] = await db.query<{
    id: string;
    result_storage_key: string | null;
    upload_id: string | null;
    status: string;
  }>(
    "select id, result_storage_key, upload_id, status from generation_jobs where id = $1 and owner_hash = $2",
    [jobId, ownerHash],
  );
  if (!job) return false;
  if (job.result_storage_key) await storage.delete(job.result_storage_key);
  await db.query(
    "update generation_jobs set result_deleted_at = now() where id = $1 and result_storage_key is not null",
    [job.id],
  );
  await db.query("update shares set revoked_at = now() where job_id = $1 and revoked_at is null", [job.id]);
  if (job.upload_id && job.status !== "QUEUED" && job.status !== "PROCESSING") {
    const [u] = await db.query<{ storage_key: string }>(
      "update uploads set deleted_at = now() where id = $1 and deleted_at is null and owner_hash = $2 returning storage_key",
      [job.upload_id, ownerHash],
    );
    if (u) await storage.delete(u.storage_key);
  }
  return true;
}
