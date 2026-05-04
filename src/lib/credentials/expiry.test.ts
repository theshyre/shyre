import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defaultExpiryYear } from "./expiry";

describe("defaultExpiryYear", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today + 365 days as YYYY-MM-DD (UTC)", () => {
    vi.setSystemTime(new Date("2026-05-01T17:00:00Z"));
    expect(defaultExpiryYear()).toBe("2027-05-01");
  });

  it("zero-pads single-digit months and days", () => {
    vi.setSystemTime(new Date("2026-01-05T00:00:00Z"));
    expect(defaultExpiryYear()).toBe("2027-01-05");
  });

  it("handles leap-year boundary by rolling over to March 1", () => {
    // Feb 29, 2028 + 1 year = Feb 29, 2029, but 2029 isn't a leap
    // year. setUTCFullYear normalizes to March 1.
    vi.setSystemTime(new Date("2028-02-29T12:00:00Z"));
    expect(defaultExpiryYear()).toBe("2029-03-01");
  });

  it("ignores local timezone — same UTC moment yields same date", () => {
    // Late-evening UTC; in PST this is still the same local day,
    // but we always anchor on UTC to keep DATE columns stable.
    vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
    expect(defaultExpiryYear()).toBe("2027-12-31");
  });
});
