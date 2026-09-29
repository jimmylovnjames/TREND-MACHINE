import "server-only";
import { cookies } from "next/headers";
import type { DeviceClass } from "@/domain/analytics";
import { getConfig } from "../config";
import { hmacHex, randomToken } from "./crypto";

export const DEVICE_COOKIE = "tm_did";
const DEVICE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface Device {
  /** Pseudonymous owner key stored in the DB. The raw cookie token is never stored. */
  ownerHash: string;
  /** Analytics id — a different HMAC purpose so analytics rows can't be joined to jobs by value. */
  anonId: string;
}

function deriveDevice(token: string): Device {
  const secret = getConfig().appSecret;
  return { ownerHash: hmacHex(secret, "owner", token), anonId: hmacHex(secret, "anon", token).slice(0, 32) };
}

/** Read the anonymous device identity. Returns null if the browser has none yet. */
export async function readDevice(): Promise<Device | null> {
  const jar = await cookies();
  const token = jar.get(DEVICE_COOKIE)?.value;
  if (!token || !DEVICE_TOKEN_RE.test(token)) return null;
  return deriveDevice(token);
}

/** Read or mint the device identity (route handlers / server actions only). */
export async function ensureDevice(): Promise<Device> {
  const existing = await readDevice();
  if (existing) return existing;
  const token = randomToken(32);
  const jar = await cookies();
  jar.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getConfig().isProduction,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return deriveDevice(token);
}

export function clientIp(req: Request): string {
  const cfg = getConfig();
  if (cfg.TRUST_PROXY_HEADERS) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return "unknown";
}

/** Day-salted IP hash: usable for daily rate limits, not for long-term tracking. */
export function ipHash(req: Request, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return hmacHex(getConfig().appSecret, `ip:${day}`, clientIp(req)).slice(0, 32);
}

export function deviceClass(userAgent: string | null): DeviceClass {
  if (!userAgent) return "unknown";
  if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(userAgent)) return "tablet";
  if (/Mobi|iPhone|Android/i.test(userAgent)) return "mobile";
  if (/Windows|Macintosh|Linux|CrOS/i.test(userAgent)) return "desktop";
  return "unknown";
}

/**
 * CSRF defence for state-changing endpoints: require a same-origin Origin (or
 * Sec-Fetch-Site) header. Cookies are SameSite=Lax as a second layer.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin" || site === "none";
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
