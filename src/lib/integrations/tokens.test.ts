import { describe, it, expect } from "vitest";
import {
  generateIntegrationToken,
  sha256Hex,
  extractBearerPat,
  redactPat,
  TOKEN_PREFIX,
  DEFAULT_TOKEN_TTL_DAYS,
  MAX_TOKEN_TTL_DAYS,
} from "./tokens";

describe("generateIntegrationToken", () => {
  it("produces a prefixed ~256-bit token whose stored hash matches sha256(raw)", () => {
    const t = generateIntegrationToken();
    expect(t.raw.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(t.raw.length).toBeGreaterThanOrEqual(TOKEN_PREFIX.length + 43);
    expect(t.hash).toBe(sha256Hex(t.raw));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.prefix).toBe(t.raw.slice(0, TOKEN_PREFIX.length + 6));
  });

  it("never produces the same token twice", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateIntegrationToken().raw),
    );
    expect(seen.size).toBe(50);
  });

  it("TTL policy: 90-day default, 1-year hard max", () => {
    expect(DEFAULT_TOKEN_TTL_DAYS).toBe(90);
    expect(MAX_TOKEN_TTL_DAYS).toBe(365);
  });
});

describe("extractBearerPat", () => {
  const valid = generateIntegrationToken().raw;

  it("accepts a well-formed Bearer header", () => {
    expect(extractBearerPat(`Bearer ${valid}`)).toBe(valid);
    expect(extractBearerPat(`  Bearer   ${valid}  `)).toBe(valid);
  });

  it("rejects missing/malformed headers and non-PAT bearers", () => {
    expect(extractBearerPat(null)).toBeNull();
    expect(extractBearerPat("")).toBeNull();
    expect(extractBearerPat(valid)).toBeNull(); // no Bearer scheme
    expect(extractBearerPat("Basic dXNlcjpwYXNz")).toBeNull();
    expect(extractBearerPat("Bearer some-jwt-looking-thing")).toBeNull();
    expect(extractBearerPat("Bearer shyre_pat_short")).toBeNull();
    expect(
      extractBearerPat(`Bearer shyre_pat_${"x".repeat(200)}`),
    ).toBeNull();
  });
});

describe("redactPat", () => {
  it("removes every PAT occurrence from log-bound strings", () => {
    const t1 = generateIntegrationToken().raw;
    const t2 = generateIntegrationToken().raw;
    const out = redactPat(`auth failed for ${t1} then retried with ${t2}!`);
    expect(out).not.toContain(t1);
    expect(out).not.toContain(t2);
    expect(out).toBe(
      "auth failed for shyre_pat_[REDACTED] then retried with shyre_pat_[REDACTED]!",
    );
  });

  it("leaves PAT-free strings untouched", () => {
    expect(redactPat("ordinary message")).toBe("ordinary message");
  });
});
