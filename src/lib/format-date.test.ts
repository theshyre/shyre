import { describe, it, expect } from "vitest";
import { formatDisplayDate, formatDisplayDateTime } from "./format-date";

describe("formatDisplayDate", () => {
  it("renders a date-only string as ITS calendar date — no UTC drift", () => {
    // In any negative-offset TZ, new Date("2026-07-16") localizes to Jul 15.
    // The formatter must print Jul 16 regardless of the runner's TZ.
    expect(formatDisplayDate("2026-07-16", "en-US")).toBe("Jul 16, 2026");
    expect(formatDisplayDate("2026-01-01", "en-US")).toBe("Jan 1, 2026");
  });

  it("passes timestamps through with their zone", () => {
    // An instant renders in the runner's local zone — just assert validity.
    expect(formatDisplayDate("2026-07-16T12:00:00+00:00", "en-US")).toMatch(
      /Jul 1[56], 2026/,
    );
  });

  it("em-dashes null/undefined/garbage", () => {
    expect(formatDisplayDate(null)).toBe("—");
    expect(formatDisplayDate(undefined)).toBe("—");
    expect(formatDisplayDate("not-a-date")).toBe("—");
  });
});

describe("formatDisplayDateTime", () => {
  it("renders date + time for a timestamptz", () => {
    expect(formatDisplayDateTime("2026-07-16T12:00:00+00:00", "en-US")).toMatch(
      /2026/,
    );
  });
  it("em-dashes empty input", () => {
    expect(formatDisplayDateTime(null)).toBe("—");
  });
});
