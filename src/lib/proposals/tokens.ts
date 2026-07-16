import "server-only";

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Token + OTP crypto for the public sign-off link (SAL-036).
 *
 * The raw sign token travels ONLY in the emailed URL; the database stores its
 * sha256. The one-time code is emailed, and its hash is bound to the token
 * row (hash(tokenId + code)) so a code can never be replayed against a
 * different link. All comparisons are constant-time.
 */

/** 32 random bytes, base64url — ~256 bits of entropy, URL-safe. */
export function generateSignToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256Hex(raw) };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 6-digit code from the CSPRNG (never Math.random). Zero-padded. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Bind the code to its token row so a code can't cross links. */
export function hashOtp(tokenId: string, code: string): string {
  return sha256Hex(`${tokenId}:${code}`);
}

/** Constant-time hex-digest comparison. */
export function digestsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Sign-link lifetime. Long enough for a busy client, short enough that a
 *  leaked mailbox doesn't hold a live link forever. The `valid_until` on the
 *  proposal itself governs the OFFER; this governs the LINK. */
export const TOKEN_TTL_DAYS = 30;

/** OTP lifetime + attempt budget before lockout. */
export const OTP_TTL_MINUTES = 10;
export const MAX_OTP_ATTEMPTS = 5;
