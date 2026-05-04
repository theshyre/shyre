import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  generateDek,
  wrapDek,
  unwrapDek,
  encryptWithDek,
  decryptWithDek,
  bytesForPg,
  getOrCreateTeamDek,
} from "./encryption";

beforeAll(() => {
  // Dev-only deterministic test key. In production this lives in
  // Vercel env. The test key is not used anywhere outside this
  // suite — see docs/guides/admin/env-configuration.md for the
  // production rotation story.
  process.env.EMAIL_KEY_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips an API-key-shaped string", () => {
    const cipher = encryptSecret("re_abc123xyz_PLACEHOLDER");
    expect(cipher).not.toBeNull();
    expect(decryptSecret(cipher)).toBe("re_abc123xyz_PLACEHOLDER");
  });

  it("returns null on null/empty input", () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret("")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it("produces non-deterministic ciphertext (random IV per encrypt)", () => {
    const a = encryptSecret("same plaintext");
    const b = encryptSecret("same plaintext");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.equals(b!)).toBe(false);
  });

  it("rejects tampered ciphertext (auth tag mismatch)", () => {
    const cipher = encryptSecret("sensitive data");
    expect(cipher).not.toBeNull();
    // Flip a byte in the data section (after IV+tag).
    const tampered = Buffer.from(cipher!);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("accepts BYTEA hex-string shape from PostgREST", () => {
    const cipher = encryptSecret("from supabase");
    expect(cipher).not.toBeNull();
    const hexShape = "\\x" + cipher!.toString("hex");
    expect(decryptSecret(hexShape)).toBe("from supabase");
  });

  it("throws on too-short ciphertext", () => {
    expect(() => decryptSecret(Buffer.from([1, 2, 3]))).toThrow();
  });
});

describe("envelope encryption (per-team DEKs)", () => {
  it("generateDek returns 32 random bytes", () => {
    const a = generateDek();
    const b = generateDek();
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(a.equals(b)).toBe(false);
  });

  it("wrapDek + unwrapDek round-trip a DEK through the master key", () => {
    const dek = generateDek();
    const wrapped = wrapDek(dek);
    expect(wrapped.length).toBe(12 + 16 + 32);
    const unwrapped = unwrapDek(wrapped);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it("wrapDek produces non-deterministic ciphertext (random IV)", () => {
    const dek = generateDek();
    const a = wrapDek(dek);
    const b = wrapDek(dek);
    expect(a.equals(b)).toBe(false);
  });

  it("unwrapDek rejects tampered ciphertext", () => {
    const wrapped = wrapDek(generateDek());
    const tampered = Buffer.from(wrapped);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => unwrapDek(tampered)).toThrow();
  });

  it("unwrapDek rejects wrong-length ciphertext", () => {
    expect(() => unwrapDek(Buffer.alloc(40))).toThrow(/unexpected length/);
  });

  it("encryptWithDek + decryptWithDek round-trip a secret through a DEK", () => {
    const dek = generateDek();
    const cipher = encryptWithDek("re_team_a_key_PLACEHOLDER", dek);
    expect(cipher).not.toBeNull();
    expect(decryptWithDek(cipher, dek)).toBe("re_team_a_key_PLACEHOLDER");
  });

  it("encryptWithDek returns null on null/empty input", () => {
    expect(encryptWithDek(null, generateDek())).toBeNull();
    expect(encryptWithDek("", generateDek())).toBeNull();
  });

  it("a DEK from one team cannot decrypt another team's ciphertext", () => {
    // Per-team isolation: two teams with separate DEKs cannot
    // read each other's secrets even though both DEKs are
    // wrapped by the same KEK.
    const dekA = generateDek();
    const dekB = generateDek();
    const cipherForA = encryptWithDek("team A's secret", dekA);
    expect(cipherForA).not.toBeNull();
    expect(() => decryptWithDek(cipherForA, dekB)).toThrow();
  });

  it("encryptWithDek rejects a wrong-length DEK", () => {
    expect(() =>
      encryptWithDek("plaintext", Buffer.alloc(16)),
    ).toThrow(/Invalid DEK/);
  });
});

describe("bytesForPg — BYTEA write serialization", () => {
  // Regression for the production bug where Buffers were passed
  // straight to supabase-js.upsert(). JSON.stringify(Buffer) emits
  // {type:"Buffer",data:[...]} which PostgREST stores as garbage,
  // and the next decrypt fails with "Unsupported state or unable
  // to authenticate data" because the auth tag won't match the
  // mangled cipher.

  it("produces the Postgres hex literal shape PostgREST accepts", () => {
    const buf = Buffer.from([0x12, 0x34, 0xab, 0xcd]);
    expect(bytesForPg(buf)).toBe("\\x1234abcd");
  });

  it("survives a JSON round-trip without losing bytes", () => {
    const cipher = encryptSecret("re_team_a_key_PLACEHOLDER");
    expect(cipher).not.toBeNull();
    const wireValue = bytesForPg(cipher!);
    const wire = JSON.stringify({ api_key_encrypted: wireValue });
    const parsed = JSON.parse(wire) as { api_key_encrypted: string };
    expect(parsed.api_key_encrypted).toBe(wireValue);
    expect(decryptSecret(parsed.api_key_encrypted)).toBe(
      "re_team_a_key_PLACEHOLDER",
    );
  });

  it("contrasts with the broken raw-Buffer path (regression guard)", () => {
    // Document the bug: a raw Buffer JSON-stringifies to an object,
    // not a string. Anyone who replaces bytesForPg with a raw
    // Buffer will trip this.
    const buf = encryptSecret("anything")!;
    const wire = JSON.stringify({ api_key_encrypted: buf });
    const parsed = JSON.parse(wire) as { api_key_encrypted: unknown };
    expect(typeof parsed.api_key_encrypted).toBe("object");
    expect(typeof bytesForPg(buf)).toBe("string");
  });
});

// The admin client is dynamically imported by getOrCreateTeamDek
// (avoids a circular import with /lib/supabase/admin in non-server
// contexts). Hoist a vi.mock so the import inside the function
// resolves to our stub.
const adminUpsertMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: (..._args: unknown[]) => adminUpsertMock(..._args),
    }),
  }),
}));

describe("getOrCreateTeamDek — self-heal regression guard", () => {
  beforeEach(() => {
    adminUpsertMock.mockReset();
  });

  // Build a stub supabase client for the read side. Each test
  // sets the dek_encrypted value the SELECT returns.
  function makeSupabase(dekRow: unknown) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: dekRow, error: null }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof getOrCreateTeamDek>[0];
  }

  it("self-heals when stored DEK has wrong length (BYTEA write bug shape)", async () => {
    // 40 bytes — wrong-length DEK ciphertext. unwrapDek throws
    // immediately on the length check; the self-heal path must
    // catch and regenerate.
    adminUpsertMock.mockResolvedValueOnce({ error: null });
    const supabase = makeSupabase({
      dek_encrypted: Buffer.alloc(40),
    });
    const dek = await getOrCreateTeamDek(supabase, "team-1");
    expect(dek.length).toBe(32);
    expect(adminUpsertMock).toHaveBeenCalledOnce();
    const [patch] = adminUpsertMock.mock.calls[0]!;
    // Wipe api_key_encrypted alongside regenerating the DEK —
    // the existing api_key was wrapped by the unrecoverable DEK
    // so it's already unreadable. Leaving it would mislead
    // downstream callers ("setup-checklist still says 'API key
    // saved'" after a self-heal).
    expect(patch).toMatchObject({
      team_id: "team-1",
      api_key_encrypted: null,
    });
    // The new DEK ciphertext must be the bytesForPg shape so
    // the round-trip survives PostgREST. Anyone who reverts to
    // raw Buffer trips this.
    expect(typeof patch.dek_encrypted).toBe("string");
    expect(patch.dek_encrypted as string).toMatch(/^\\x[0-9a-f]+$/);
  });

  it("self-heals when stored DEK fails auth-tag check (tampered cipher)", async () => {
    adminUpsertMock.mockResolvedValueOnce({ error: null });
    // Generate a valid wrap then flip a byte in the ciphertext —
    // length stays correct, auth-tag fails. unwrapDek throws via
    // the GCM auth-tag check; same self-heal must apply.
    const realDek = generateDek();
    const wrapped = wrapDek(realDek);
    const tampered = Buffer.from(wrapped);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff);
    const supabase = makeSupabase({ dek_encrypted: tampered });
    const dek = await getOrCreateTeamDek(supabase, "team-2");
    expect(dek.length).toBe(32);
    // Confirm we got a NEW DEK, not the tampered one decoded.
    expect(dek.equals(realDek)).toBe(false);
    expect(adminUpsertMock).toHaveBeenCalledOnce();
  });

  it("returns existing DEK when stored row unwraps cleanly (no regeneration)", async () => {
    // Sanity: the self-heal path must NOT fire on a healthy row.
    // A future "cleanup" PR that loosens the catch and rethrows
    // would silently destroy production data — this test pins
    // the contract.
    const realDek = generateDek();
    const wrapped = wrapDek(realDek);
    const supabase = makeSupabase({ dek_encrypted: wrapped });
    const dek = await getOrCreateTeamDek(supabase, "team-3");
    expect(dek.equals(realDek)).toBe(true);
    expect(adminUpsertMock).not.toHaveBeenCalled();
  });

  it("creates a new DEK when no row exists (first-save path)", async () => {
    adminUpsertMock.mockReset();
    adminUpsertMock.mockResolvedValueOnce({ error: null });
    const supabase = makeSupabase(null);
    const dek = await getOrCreateTeamDek(supabase, "team-4");
    expect(dek.length).toBe(32);
    expect(adminUpsertMock).toHaveBeenCalledOnce();
    const [patch] = adminUpsertMock.mock.calls[0]!;
    // First-save shouldn't wipe an api_key — but the upsert
    // payload includes the field as null on this code path
    // (it's the same upsert the self-heal uses). That's OK
    // because the row doesn't exist yet, so "set api_key to
    // null" effectively means "leave unset."
    expect(patch.api_key_encrypted).toBeNull();
  });
});
