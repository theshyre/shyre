import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * App-side AES-256-GCM secret encryption with envelope-encryption
 * support for per-team isolation.
 *
 * Two layers:
 *
 *   1. KEK (key-encryption-key) — single instance-wide master key
 *      from EMAIL_KEY_ENCRYPTION_KEY. Used ONLY to wrap/unwrap
 *      DEKs. Never directly encrypts user secrets going forward
 *      (legacy rows still decrypt this way as a fallback — see
 *      `decryptForTeam`).
 *
 *   2. DEK (data-encryption-key) — per-team 32-byte key generated
 *      on first save, stored as `team_email_config.dek_encrypted`
 *      (KEK-wrapped). Encrypts the team's actual secrets
 *      (`api_key_encrypted` etc.).
 *
 * Why envelope: per-team key isolation, cheap KEK rotation, better
 * compliance posture for multi-tenant SaaS. Cost is one extra
 * encryption hop and a small DEK lifecycle. SAL-018 documents the
 * upgrade path from the Phase-1 single-key model.
 *
 * The legacy `encryptSecret` / `decryptSecret` exports remain for
 * non-team contexts (system-level secrets that don't belong to a
 * team — Vercel API token in instance_deploy_config etc.).
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

/**
 * Serialize a Buffer for a PostgREST BYTEA column WRITE.
 *
 * supabase-js / postgrest-js uses `JSON.stringify` on the request
 * body. Node's `Buffer.toJSON()` returns `{type: "Buffer",
 * data: [...]}` — PostgREST receives that object instead of a
 * scalar value, can't coerce it to bytea, and silently stores the
 * JSON text. The cipher round-trip then fails on the auth tag.
 *
 * The fix: pre-format the Buffer as Postgres's hex literal
 * (`\x<hex>`), which PostgREST happily parses as bytea on the way
 * in. Read path is unaffected — `toBuffer()` already handles the
 * hex-string shape.
 *
 * EVERY place that writes a Buffer into a BYTEA column via
 * supabase-js MUST go through this helper. Adding a new BYTEA
 * column? Wrap the cipher with `bytesForPg(...)` at the call site.
 */
export function bytesForPg(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

// ────────────────────────────────────────────────────────────────
// Envelope encryption (per-team DEKs)
// ────────────────────────────────────────────────────────────────

/** Generate a fresh 32-byte AES-256 data key. Called on first save
 *  for a team, or during DEK rotation. */
export function generateDek(): Buffer {
  return randomBytes(KEY_LENGTH_BYTES);
}

/** Wrap a DEK with the instance master key. Output shape matches
 *  `encryptSecret` (IV || tag || ciphertext) so storage logic is
 *  identical. */
export function wrapDek(dek: Buffer): Buffer {
  if (dek.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `DEK must be ${KEY_LENGTH_BYTES} bytes; got ${dek.length}.`,
    );
  }
  const kek = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, kek, iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/** Unwrap a stored DEK ciphertext. Throws on tampering / wrong
 *  master key. */
export function unwrapDek(
  ciphertext: Buffer | Uint8Array | string,
): Buffer {
  const buf = toBuffer(ciphertext);
  if (buf.length !== IV_LENGTH + AUTH_TAG_LENGTH + KEY_LENGTH_BYTES) {
    throw new Error("DEK ciphertext has unexpected length.");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const kek = loadKey();
  const decipher = createDecipheriv(ALGORITHM, kek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** Encrypt a plaintext string with a specific DEK. Same wire shape
 *  as `encryptSecret` so on-disk layout is consistent across
 *  layers. */
export function encryptWithDek(
  plaintext: string | null,
  dek: Buffer,
): Buffer | null {
  if (plaintext == null || plaintext === "") return null;
  if (dek.length !== KEY_LENGTH_BYTES) {
    throw new Error("Invalid DEK length.");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/** Decrypt with a specific DEK. Throws on tampering / wrong DEK. */
export function decryptWithDek(
  ciphertext: Buffer | Uint8Array | string | null,
  dek: Buffer,
): string | null {
  if (ciphertext == null) return null;
  const buf = toBuffer(ciphertext);
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Ciphertext too short to be a valid GCM blob.");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Get the team's DEK, generating + persisting one if the team
 * doesn't have one yet. The new DEK is wrapped with the KEK before
 * landing in `team_email_config.dek_encrypted`.
 *
 * Idempotent: callers can invoke per-save without worrying about
 * race conditions (the upsert collapses concurrent first-saves).
 *
 * Uses the admin client so RLS doesn't block the implicit upsert
 * during a server action that hasn't yet validated team access.
 * Callers MUST validate team access before calling.
 */
export async function getOrCreateTeamDek(
  supabase: SupabaseClient,
  teamId: string,
): Promise<Buffer> {
  const { data } = await supabase
    .from("team_email_config")
    .select("dek_encrypted")
    .eq("team_id", teamId)
    .maybeSingle();

  if (data?.dek_encrypted) {
    try {
      return unwrapDek(data.dek_encrypted as Buffer | string);
    } catch {
      // Self-heal a corrupt DEK row. Falls through to the
      // regenerate path below, which also wipes
      // api_key_encrypted — that ciphertext was wrapped by the
      // unrecoverable DEK so it's already garbage. The user's
      // next API-key save lands cleanly under the new DEK.
      //
      // Original cause: the BYTEA write path serialized Buffer
      // through JSON.stringify before bytesForPg landed,
      // leaving wrong-length / unauthenticatable ciphertext in
      // the DB. Self-healing here lets affected rows recover
      // without DB surgery.
    }
  }

  // Generate + persist via upsert. The upsert handles the case
  // where team_email_config has no row at all (first email setup
  // for the team), the case where the row exists but
  // dek_encrypted is NULL (legacy row, pre-envelope upgrade),
  // and the self-heal case where the existing dek_encrypted is
  // unrecoverable (clear it and api_key_encrypted together).
  const dek = generateDek();
  const dekCipher = wrapDek(dek);
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { error } = await admin
    .from("team_email_config")
    .upsert(
      {
        team_id: teamId,
        dek_encrypted: bytesForPg(dekCipher),
        // Wipe api_key_encrypted — under the old DEK it's
        // unreadable. Leaving it would mislead callers like
        // setup-checklist into thinking a key is configured.
        api_key_encrypted: null,
      },
      { onConflict: "team_id" },
    );
  if (error) {
    throw new Error(`Failed to persist team DEK: ${error.message}`);
  }
  return dek;
}

/**
 * Encrypt a plaintext string for a team. Generates the team's DEK
 * if it doesn't have one. Output is the same wire shape as
 * `encryptSecret` — callers store it as BYTEA.
 */
export async function encryptForTeam(
  supabase: SupabaseClient,
  teamId: string,
  plaintext: string,
): Promise<Buffer> {
  const dek = await getOrCreateTeamDek(supabase, teamId);
  const cipher = encryptWithDek(plaintext, dek);
  if (!cipher) {
    throw new Error("encryptForTeam called with empty plaintext.");
  }
  return cipher;
}

/**
 * Decrypt a stored ciphertext for a team. Tries the team's DEK
 * first; on failure (no DEK row, or auth-tag mismatch on the DEK
 * path) falls back to legacy direct-KEK decryption — that's how
 * Phase-1 ciphertexts produced before envelope encryption are
 * still readable. The next encryptForTeam call upgrades the row
 * forward to DEK-encrypted.
 *
 * Returns null only when the input is null. A bad ciphertext
 * (tampered, wrong key both ways) throws.
 */
export async function decryptForTeam(
  supabase: SupabaseClient,
  teamId: string,
  ciphertext: Buffer | Uint8Array | string | null,
): Promise<string | null> {
  if (ciphertext == null) return null;

  const { data } = await supabase
    .from("team_email_config")
    .select("dek_encrypted")
    .eq("team_id", teamId)
    .maybeSingle();

  if (data?.dek_encrypted) {
    try {
      const dek = unwrapDek(data.dek_encrypted as Buffer | string);
      return decryptWithDek(ciphertext, dek);
    } catch {
      // Fall through to legacy direct-KEK decrypt. This handles
      // rows where dek_encrypted exists but the api_key was
      // saved under the old direct-KEK path (during the upgrade
      // window).
    }
  }

  // Legacy: ciphertext was wrapped directly with the KEK. The
  // next encryptForTeam upgrades it forward.
  return decryptSecret(ciphertext);
}
