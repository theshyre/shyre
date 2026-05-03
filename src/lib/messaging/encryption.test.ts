import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  generateDek,
  wrapDek,
  unwrapDek,
  encryptWithDek,
  decryptWithDek,
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
