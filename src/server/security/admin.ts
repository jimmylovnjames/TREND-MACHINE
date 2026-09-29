import "server-only";
import { cookies } from "next/headers";
import { adminEnabled, getConfig } from "../config";
import { hmacB64, safeEqual } from "./crypto";

/**
 * Admin sessions: a single shared ADMIN_TOKEN (>= 32 chars) exchanged for a signed,
 * short-lived, httpOnly SameSite=Strict cookie. If ADMIN_TOKEN is not configured the
 * admin area is fully disabled (no read, no write).
 *
 * This is deliberately minimal; replace with SSO / per-user accounts before a team
 * larger than a few trusted operators uses it.
 */
export const ADMIN_COOKIE = "tm_admin";
const SESSION_SECONDS = 12 * 3600;

export function checkAdminToken(candidate: string): boolean {
  const cfg = getConfig();
  if (!adminEnabled(cfg)) return false;
  return safeEqual(candidate, cfg.ADMIN_TOKEN!);
}

function sign(exp: number): string {
  const cfg = getConfig();
  // Binding the signature to the token means rotating ADMIN_TOKEN revokes all sessions.
  return hmacB64(cfg.appSecret, "admin-session", `${exp}:${cfg.ADMIN_TOKEN}`);
}

export async function createAdminSession(): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  (await cookies()).set(ADMIN_COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: getConfig().isProduction,
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  if (!adminEnabled()) return false;
  const v = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!v) return false;
  const [expStr, sig] = v.split(".");
  if (!expStr || !sig || !/^\d+$/.test(expStr)) return false;
  const exp = Number(expStr);
  if (exp < Date.now() / 1000) return false;
  return safeEqual(sign(exp), sig);
}

export class AdminAuthError extends Error {}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new AdminAuthError("admin session required");
}
