import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./encryption";

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
