import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { apiError, generationError, logError, noStore, rejectCrossSite } from "@/server/http";
import { readJsonCapped } from "@/server/body";
import {
  dispatchJob,
  GenerationRequestError,
  jobViewFor,
  requestGeneration,
} from "@/server/generation/service";
import type { JobRow } from "@/server/generation/jobs";
import { deviceClass, ensureDevice, ipHash, readDevice } from "@/server/security/request";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    templateSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
    uploadId: z.string().uuid().nullish(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    rightsConfirmed: z.literal(true),
    regenerateOf: z.string().uuid().nullish(),
  })
  .strict()
  .refine((b) => b.uploadId || b.regenerateOf, { message: "uploadId required" });

export async function POST(req: Request) {
  const csrf = rejectCrossSite(req);
  if (csrf) return csrf;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await readJsonCapped(req));
  } catch {
    return apiError(400, "INVALID_INPUT", "Invalid request.", noStore);
  }
  const device = await ensureDevice();
  try {
    const db = await getDb();
    const res = await requestGeneration({
      ownerHash: device.ownerHash,
      anonId: device.anonId,
      ipHash: ipHash(req),
      deviceClass: deviceClass(req.headers.get("user-agent")),
      templateSlug: body.templateSlug,
      uploadId: body.uploadId ?? null,
      idempotencyKey: body.idempotencyKey,
      rightsConfirmed: body.rightsConfirmed,
      regenerateOf: body.regenerateOf ?? null,
    });
    if (res.needsDispatch) {
      // Respond immediately; submit to the provider after the response is sent.
      // If this process dies, the status endpoint / cron will pick the job up.
      after(async () => {
        try {
          await dispatchJob(res.job.id);
        } catch (e) {
          logError("dispatch", e);
        }
      });
    }
    return NextResponse.json(
      { job: await jobViewFor(db, res.job) },
      { status: res.created ? 201 : 200, headers: noStore },
    );
  } catch (e) {
    if (e instanceof GenerationRequestError) {
      return e.publicMessage
        ? apiError(e.status, e.code, e.publicMessage, noStore)
        : generationError(e.status, e.code, noStore);
    }
    logError("generations", e);
    return generationError(500, "INTERNAL_ERROR", noStore);
  }
}

/** The caller's own generations (device-scoped). */
export async function GET() {
  const device = await readDevice();
  if (!device) return NextResponse.json({ jobs: [] }, { headers: noStore });
  const db = await getDb();
  const rows = await db.query<JobRow>(
    "select * from generation_jobs where owner_hash = $1 order by created_at desc limit 50",
    [device.ownerHash],
  );
  const jobs = await Promise.all(rows.map((r) => jobViewFor(db, r)));
  return NextResponse.json({ jobs }, { headers: noStore });
}
