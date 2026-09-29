import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { apiError, noStore, rejectCrossSite } from "@/server/http";
import { deleteDeviceData } from "@/server/retention";
import { readDevice } from "@/server/security/request";

export const dynamic = "force-dynamic";

/** Delete every photo, video and share link tied to this device. */
export async function DELETE(req: Request) {
  const csrf = rejectCrossSite(req);
  if (csrf) return csrf;
  const device = await readDevice();
  if (!device)
    return NextResponse.json({ deleted: { uploads: 0, results: 0, shares: 0 } }, { headers: noStore });
  try {
    const deleted = await deleteDeviceData(await getDb(), device.ownerHash);
    return NextResponse.json({ deleted }, { headers: noStore });
  } catch {
    return apiError(500, "INTERNAL_ERROR", "Deletion failed. Please try again.", noStore);
  }
}
