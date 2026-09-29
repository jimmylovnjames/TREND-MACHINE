import { NextResponse } from "next/server";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db";
import { apiError, logError, noStore, rejectCrossSite } from "@/server/http";
import { BodyTooLargeError, readBodyCapped } from "@/server/body";
import { ensureDevice } from "@/server/security/request";
import { ImageValidationError, imageRejectMessage } from "@/server/uploads/image";
import { saveSourcePhoto, UploadRateLimitedError } from "@/server/uploads/service";

export const dynamic = "force-dynamic";

/**
 * Upload a source photo as the raw request body (image/jpeg|png|webp).
 * The client crops/re-encodes before upload; the server re-validates everything.
 */
export async function POST(req: Request) {
  const csrf = rejectCrossSite(req);
  if (csrf) return csrf;
  const device = await ensureDevice();
  const cfg = getConfig();
  let raw: Uint8Array;
  try {
    raw = await readBodyCapped(req, cfg.MAX_UPLOAD_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError)
      return apiError(413, "INVALID_INPUT", imageRejectMessage("TOO_LARGE"), noStore);
    return apiError(400, "UPLOAD_FAILED", undefined, noStore);
  }
  try {
    const db = await getDb();
    const upload = await saveSourcePhoto(db, device.ownerHash, raw);
    return NextResponse.json({ upload }, { status: 201, headers: noStore });
  } catch (e) {
    if (e instanceof ImageValidationError) return apiError(422, "INVALID_INPUT", e.message, noStore);
    if (e instanceof UploadRateLimitedError)
      return apiError(429, "RATE_LIMITED", "Too many uploads. Please wait a bit.", noStore);
    logError("uploads", e);
    return apiError(500, "UPLOAD_FAILED", undefined, noStore);
  }
}
