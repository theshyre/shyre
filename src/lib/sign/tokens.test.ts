import { describe, it, expect } from "vitest";
import {
  generateSignToken,
  sha256Hex,
  generateOtpCode,
  hashOtp,
  digestsEqual,
  viewSessionCookieName,
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MINUTES,
  TOKEN_TTL_DAYS,
  VIEW_SESSION_TTL_HOURS,
} from "./tokens";

describe("sign tokens (shared primitives)", () => {
  it("generates URL-safe tokens whose stored hash matches sha256(raw)", () => {
    const { raw, hash } = generateSignToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw.length).toBeGreaterThanOrEqual(43);
    expect(hash).toBe(sha256Hex(raw));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateSignToken().raw),
    );
    expect(seen.size).toBe(50);
  });

  it("OTP codes are always exactly 6 digits and token-bound", () => {
    for (let i = 0; i < 100; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
    expect(hashOtp("t-a", "123456")).not.toBe(hashOtp("t-b", "123456"));
    expect(hashOtp("t-a", "123456")).toBe(hashOtp("t-a", "123456"));
  });

  it("digestsEqual is constant-time-safe and rejects malformed input", () => {
    expect(digestsEqual(sha256Hex("x"), sha256Hex("x"))).toBe(true);
    expect(digestsEqual(sha256Hex("x"), sha256Hex("y"))).toBe(false);
    expect(digestsEqual("", "")).toBe(false);
    expect(digestsEqual("zz", sha256Hex("x"))).toBe(false);
  });

  it("view-session cookie name is per-link (derived from the token hash)", () => {
    const a = generateSignToken().raw;
    const b = generateSignToken().raw;
    expect(viewSessionCookieName(a)).toMatch(/^sv_[0-9a-f]{16}$/);
    expect(viewSessionCookieName(a)).not.toBe(viewSessionCookieName(b));
  });

  it("pins the documented security posture", () => {
    expect(TOKEN_TTL_DAYS).toBe(30);
    expect(OTP_TTL_MINUTES).toBe(10);
    expect(MAX_OTP_ATTEMPTS).toBe(5);
    expect(VIEW_SESSION_TTL_HOURS).toBe(24);
  });
});
