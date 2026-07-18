import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Personal-access-token crypto for the integrations surface (SAL-051).
 *
 * Same primitives as the sign-link stack (`src/lib/proposals/tokens.ts`,
 * SAL-036): 256-bit CSPRNG raw value, sha256 hex at rest, prefix-only
 * display. sha256 (not argon2) is correct here — the input is 256-bit
 * random, so brute force is not the threat, and the hash must be
 * indexable for `WHERE token_hash = $1` lookup.
 *
 * The `shyre_pat_` prefix makes tokens grep-able in CI/secret-scanning
 * and lets log-redaction target them (security review T1: assume the
 * token WILL appear in an agent transcript eventually).
 */

export const TOKEN_PREFIX = "shyre_pat_";

/** Length of the display prefix stored beside the hash ("shyre_pat_ab34cd"). */
const DISPLAY_PREFIX_CHARS = TOKEN_PREFIX.length + 6;

export const DEFAULT_TOKEN_TTL_DAYS = 90;
export const MAX_TOKEN_TTL_DAYS = 365;

export interface GeneratedToken {
  /** Full raw token — returned to the user EXACTLY once, at creation. */
  raw: string;
  /** sha256 hex of the raw token — the only thing stored. */
  hash: string;
  /** First characters for list display ("shyre_pat_ab34cd"). */
  prefix: string;
}

export function generateIntegrationToken(): GeneratedToken {
  const raw = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { raw, hash: sha256Hex(raw), prefix: raw.slice(0, DISPLAY_PREFIX_CHARS) };
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Extract the bearer token from an Authorization header. Returns null for
 * anything that isn't a well-formed `Bearer shyre_pat_…` value — the token
 * is accepted ONLY here: never a query param (query strings land in logs,
 * history, and transcripts), never a cookie, never a body field.
 */
export function extractBearerPat(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)$/.exec(authorization.trim());
  if (!m || !m[1]) return null;
  const candidate = m[1];
  if (!candidate.startsWith(TOKEN_PREFIX)) return null;
  // 32 bytes base64url = 43 chars; reject obviously malformed values
  // before they reach the database.
  if (candidate.length < TOKEN_PREFIX.length + 40 || candidate.length > 128) {
    return null;
  }
  return candidate;
}

/** Redact any PAT occurrences from a string destined for logs/errors. */
export function redactPat(value: string): string {
  return value.replace(/shyre_pat_[A-Za-z0-9_-]+/g, "shyre_pat_[REDACTED]");
}
