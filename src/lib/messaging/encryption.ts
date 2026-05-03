import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-side AES-256-GCM secret encryption.
 *
 * Used for `team_email_config.api_key_encrypted` and the in-progress
 * migration of `user_settings.github_token_encrypted` (SAL-015).
 * The encryption key never reaches Postgres — the DB stores opaque
 * BYTEA, and decrypt only happens inside `server-only` modules.
 *
 * Why GCM: authenticated encryption. We get integrity (the auth tag
 * detects tampering) AND confidentiality from a single primitive,
 * which sidesteps the foot-gun of pairing a cipher with a separate
 * MAC. The IV is 12 bytes (NIST recommended for GCM). The auth tag
 * is 16 bytes.
 *
 * Ciphertext layout (single BYTEA blob the DB stores):
 *   [12-byte IV][16-byte auth tag][ciphertext bytes]
 *
 * Master key: hex-encoded 32 bytes in `EMAIL_KEY_ENCRYPTION_KEY`
 * (Vercel env). Generate with `openssl rand -hex 32`.
 *
 * Threat model: protects against compromised DB dumps / pg_dump
 * leaks / backup tarballs. Does NOT protect against a compromised
 * Vercel function (the master key is in env there) or a stolen
 * service-role token that can call the decrypt path. Defense in
 * depth, not a silver bullet.
 *
 * If the master key is ever lost, every stored secret becomes
 * unrecoverable garbage and users have to re-paste their API keys.
 * Documented in docs/guides/admin/env-configuration.md.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH_BYTES = 32;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.EMAIL_KEY_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "EMAIL_KEY_ENCRYPTION_KEY env var not set. Generate with `openssl rand -hex 32`. See docs/guides/admin/env-configuration.md.",
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      "EMAIL_KEY_ENCRYPTION_KEY must be hex-encoded.",
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `EMAIL_KEY_ENCRYPTION_KEY must be ${KEY_LENGTH_BYTES} bytes (${KEY_LENGTH_BYTES * 2} hex chars). Got ${buf.length} bytes.`,
    );
  }
  cachedKey = buf;
  return buf;
}

/** Encrypt a plaintext string. Returns `null` for null/empty input
 *  so callers can pipe straight into a nullable BYTEA column. */
export function encryptSecret(plaintext: string | null): Buffer | null {
  if (plaintext == null || plaintext === "") return null;
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/** Decrypt a stored ciphertext blob. Returns `null` for null input;
 *  throws on tampering / wrong key (auth-tag mismatch).
 *  Accepts Buffer, Uint8Array, or the hex-string shape Supabase
 *  returns BYTEA as ("\x...") so the caller doesn't have to know. */
export function decryptSecret(
  ciphertext: Buffer | Uint8Array | string | null,
): string | null {
  if (ciphertext == null) return null;
  const buf = toBuffer(ciphertext);
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Ciphertext too short to be a valid GCM blob.");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function toBuffer(input: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === "string") {
    // Supabase serializes BYTEA as `\x<hex>` over PostgREST.
    if (input.startsWith("\\x")) return Buffer.from(input.slice(2), "hex");
    return Buffer.from(input, "hex");
  }
  return Buffer.from(input);
}
