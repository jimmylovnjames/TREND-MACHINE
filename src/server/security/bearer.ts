import "server-only";
import { safeEqual } from "./crypto";

/** Constant-time bearer token check. A missing configured secret always denies. */
export function checkBearer(req: Request, expected: string | undefined): boolean {
  if (!expected || expected.length < 24) return false;
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer (.+)$/);
  return !!m && safeEqual(m[1]!, expected);
}
