import { describe, it, expect } from "vitest";
import {
  generateSignToken,
  sha256Hex,
  generateOtpCode,
  hashOtp,
  digestsEqual,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MINUTES,
  TOKEN_TTL_DAYS,
} from "./tokens";

describe("sign tokens", () => {
  it("generates URL-safe tokens whose stored hash matches sha256(raw)", () => {
    const { raw, hash } = generateSignToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // base64url — safe in a path
    expect(raw.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(hash).toBe(sha256Hex(raw));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateSignToken().raw),
    );
    expect(seen.size).toBe(50);
  });
});

describe("OTP codes", () => {
  it("is always exactly 6 digits (zero-padded)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("binds the code hash to the token id — same code, different token, different hash", () => {
    expect(hashOtp("token-a", "123456")).not.toBe(hashOtp("token-b", "123456"));
    expect(hashOtp("token-a", "123456")).toBe(hashOtp("token-a", "123456"));
  });
});

describe("digestsEqual", () => {
  it("matches equal digests and rejects different ones", () => {
    const a = sha256Hex("hello");
    expect(digestsEqual(a, sha256Hex("hello"))).toBe(true);
    expect(digestsEqual(a, sha256Hex("world"))).toBe(false);
  });

  it("rejects malformed or empty inputs without throwing", () => {
    expect(digestsEqual("", "")).toBe(false);
    expect(digestsEqual("zz", sha256Hex("x"))).toBe(false);
  });
});

describe("policy constants", () => {
  it("keeps the documented security posture", () => {
    expect(TOKEN_TTL_DAYS).toBe(30);
    expect(OTP_TTL_MINUTES).toBe(10);
    expect(MAX_OTP_ATTEMPTS).toBe(5);
  });
});
