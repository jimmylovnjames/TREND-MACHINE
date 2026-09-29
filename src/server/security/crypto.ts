import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacHex(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}\u0000${value}`).digest("hex");
}

export function hmacB64(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}\u0000${value}`).digest("base64url");
}

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
