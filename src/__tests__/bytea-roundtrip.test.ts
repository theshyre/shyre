import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  bytesForPg,
  decryptSecret,
  encryptSecret,
} from "@/lib/messaging/encryption";

/**
 * BYTEA round-trip integration test.
 *
 * The unit tests in `encryption.test.ts` prove the wire shape that
 * `bytesForPg` emits and that `toBuffer` accepts the matching read
 * shape. What they do *not* prove is what actually happens when
 * the cipher rides supabase-js → PostgREST → bytea → SELECT and
 * back. That round-trip was the production bug that motivated
 * this whole helper — and a future contributor reverting to a
 * raw `Buffer` (which serializes as `{type:"Buffer",data:[...]}`
 * via JSON.stringify) would pass every unit test and break
 * production silently.
 *
 * This test gates on `NEXT_PUBLIC_SUPABASE_URL` +
 * `SUPABASE_SERVICE_ROLE_KEY` being present. CI in environments
 * without them (the matrix that doesn't run db:push) skips
 * automatically. Local runs and any CI job that has the secrets
 * exercise the real round-trip.
 *
 * Uses the existing `team_email_config.dek_encrypted` column as
 * a convenient bytea endpoint — same shape the production write
 * path uses. The team row is created and torn down inline so the
 * test doesn't pollute existing data.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const skip = !SUPABASE_URL || !SERVICE_ROLE;

beforeAll(() => {
  // Encryption module needs a master key to compute the cipher
  // shape. Reuse the same dev-only deterministic key the
  // encryption.test.ts suite uses; the bytes never escape this
  // process so this isn't a secret-handling concern.
  process.env.EMAIL_KEY_ENCRYPTION_KEY ??=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe.skipIf(skip)("BYTEA round-trip via supabase-js + PostgREST", () => {
  it("cipher survives bytesForPg → write → read → decryptSecret intact", async () => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { persistSession: false },
    });

    // Borrow an existing team row so we don't have to provision
    // a full team graph just for this test. Pick the first
    // already-configured team_email_config row OR any team if
    // the email-config table is empty.
    const { data: anyConfig } = await admin
      .from("team_email_config")
      .select("team_id")
      .limit(1)
      .maybeSingle();
    const { data: anyTeam } = anyConfig
      ? { data: { id: anyConfig.team_id as string } }
      : await admin.from("teams").select("id").limit(1).single();
    const teamId = (anyTeam as { id: string } | null)?.id;
    if (!teamId) {
      // No teams exist in this DB — nothing to round-trip
      // through. Fail loudly so CI signals "you need at least
      // one team for this test to run."
      throw new Error(
        "BYTEA round-trip test needs at least one team row. Run db seeds or skip the suite.",
      );
    }

    const cipher = encryptSecret("re_round_trip_PLACEHOLDER")!;
    const wireValue = bytesForPg(cipher);

    // Write into a real bytea column and read back through PostgREST
    // (the same path the messaging module uses). dek_encrypted is
    // safe to overwrite for this test — we restore the original
    // value at the end so production data isn't disturbed.
    const { data: pre } = await admin
      .from("team_email_config")
      .select("dek_encrypted")
      .eq("team_id", teamId)
      .maybeSingle();
    const originalDek = pre?.dek_encrypted ?? null;

    try {
      const { error: upsertErr } = await admin
        .from("team_email_config")
        .upsert(
          { team_id: teamId, dek_encrypted: wireValue },
          { onConflict: "team_id" },
        );
      expect(upsertErr).toBeNull();

      const { data: read, error: readErr } = await admin
        .from("team_email_config")
        .select("dek_encrypted")
        .eq("team_id", teamId)
        .maybeSingle();
      expect(readErr).toBeNull();
      expect(read?.dek_encrypted).toBeTruthy();

      // The whole point: the cipher decrypts back to the
      // plaintext we encrypted. Anything that breaks the wire
      // (raw Buffer regression, encoding drift, PostgREST
      // changing its bytea handling) fails right here.
      const decrypted = decryptSecret(
        read?.dek_encrypted as string | Buffer,
      );
      expect(decrypted).toBe("re_round_trip_PLACEHOLDER");
    } finally {
      // Restore the team's original DEK (or clear it if the row
      // didn't exist beforehand) so the test doesn't leave
      // collateral.
      await admin
        .from("team_email_config")
        .update({ dek_encrypted: originalDek })
        .eq("team_id", teamId);
    }
  });
});
