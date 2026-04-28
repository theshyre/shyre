import { describe, it, expect } from "vitest";
import { daysUntilExpiry, expiryStatus } from "./credential-expiry";

const today = new Date("2026-04-28T12:00:00Z");

describe("daysUntilExpiry", () => {
  it("returns null for null/undefined input", () => {
    expect(daysUntilExpiry(null, today)).toBeNull();
    expect(daysUntilExpiry(undefined, today)).toBeNull();
  });

  it("returns null for malformed dates", () => {
    expect(daysUntilExpiry("not-a-date", today)).toBeNull();
    expect(daysUntilExpiry("", today)).toBeNull();
  });

  it("returns 0 when expiry is today", () => {
    expect(daysUntilExpiry("2026-04-28", today)).toBe(0);
  });

  it("returns positive days when expiry is in the future", () => {
    expect(daysUntilExpiry("2026-05-05", today)).toBe(7);
    expect(daysUntilExpiry("2027-04-28", today)).toBe(365);
  });

  it("returns negative days when expiry is in the past", () => {
    expect(daysUntilExpiry("2026-04-25", today)).toBe(-3);
  });

  it("treats ISO timestamp and YYYY-MM-DD identically (day granularity)", () => {
    expect(daysUntilExpiry("2026-05-05T15:30:00Z", today)).toBe(7);
    expect(daysUntilExpiry("2026-05-05", today)).toBe(7);
  });
});

describe("expiryStatus", () => {
  it("returns null when no date is set", () => {
    expect(expiryStatus(null, today)).toBeNull();
    expect(expiryStatus("", today)).toBeNull();
  });

  it("returns null when the date can't be parsed", () => {
    expect(expiryStatus("invalid", today)).toBeNull();
  });

  it("returns 'expired' for any past date", () => {
    expect(expiryStatus("2026-04-27", today)).toBe("expired");
    expect(expiryStatus("2024-01-01", today)).toBe("expired");
  });

  it("returns 'critical' within 3 days (inclusive)", () => {
    expect(expiryStatus("2026-04-28", today)).toBe("critical"); // today
    expect(expiryStatus("2026-04-29", today)).toBe("critical"); // +1
    expect(expiryStatus("2026-05-01", today)).toBe("critical"); // +3
  });

  it("returns 'warning' between 4 and 14 days (inclusive)", () => {
    expect(expiryStatus("2026-05-02", today)).toBe("warning"); // +4
    expect(expiryStatus("2026-05-12", today)).toBe("warning"); // +14
  });

  it("returns 'ok' beyond 14 days", () => {
    expect(expiryStatus("2026-05-13", today)).toBe("ok"); // +15
    expect(expiryStatus("2027-04-28", today)).toBe("ok");
  });
});
