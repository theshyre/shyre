import { describe, it, expect } from "vitest";
import { localDayBoundsIso, isInLocalDay } from "./local-day-bounds";

describe("localDayBoundsIso", () => {
  it("returns a [start, end] pair separated by exactly 24 hours", () => {
    const now = new Date(2026, 4, 15, 13, 30, 0);
    const [startIso, endIso] = localDayBoundsIso(now);
    const start = new Date(startIso);
    const end = new Date(endIso);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("start is local midnight on the input date (00:00:00 in local TZ)", () => {
    const now = new Date(2026, 4, 15, 13, 30, 0);
    const [startIso] = localDayBoundsIso(now);
    const start = new Date(startIso);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(4);
    expect(start.getDate()).toBe(15);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it("end is local midnight of the NEXT day", () => {
    const now = new Date(2026, 4, 15, 13, 30, 0);
    const [, endIso] = localDayBoundsIso(now);
    const end = new Date(endIso);
    expect(end.getDate()).toBe(16);
    expect(end.getHours()).toBe(0);
  });

  it("crosses month boundary correctly (last day of month)", () => {
    const now = new Date(2026, 4, 31, 23, 59, 0);
    const [, endIso] = localDayBoundsIso(now);
    const end = new Date(endIso);
    expect(end.getMonth()).toBe(5); // June
    expect(end.getDate()).toBe(1);
  });

  it("crosses year boundary correctly", () => {
    const now = new Date(2026, 11, 31, 23, 59, 0);
    const [, endIso] = localDayBoundsIso(now);
    const end = new Date(endIso);
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(0);
    expect(end.getDate()).toBe(1);
  });

  it("defaults `now` to the actual current time when omitted", () => {
    const [startIso, endIso] = localDayBoundsIso();
    const start = new Date(startIso);
    const end = new Date(endIso);
    const today = new Date();
    expect(start.getDate()).toBe(today.getDate());
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isInLocalDay", () => {
  const dayStart = "2026-05-12T07:00:00.000Z";
  const dayEnd = "2026-05-13T07:00:00.000Z";

  it("returns true for a timestamp inside the window", () => {
    expect(isInLocalDay("2026-05-12T14:30:00.000Z", dayStart, dayEnd)).toBe(
      true,
    );
  });

  it("returns true for a timestamp exactly at the lower bound", () => {
    expect(isInLocalDay("2026-05-12T07:00:00.000Z", dayStart, dayEnd)).toBe(
      true,
    );
  });

  it("returns false for a timestamp exactly at the upper bound (half-open)", () => {
    expect(isInLocalDay("2026-05-13T07:00:00.000Z", dayStart, dayEnd)).toBe(
      false,
    );
  });

  it("returns false for a timestamp before the window", () => {
    expect(isInLocalDay("2026-05-12T06:59:59.999Z", dayStart, dayEnd)).toBe(
      false,
    );
  });

  // The bug this guards against: Postgres `timestamptz` serializes to
  // `"YYYY-MM-DDTHH:MM:SS+00:00"`. Comparing that string against a
  // `Date.toISOString()` bound (`"...Z"`) lexicographically marks the
  // entry as "before the window" because `+` (0x2B) < `Z` (0x5A).
  // Forces numeric comparison.
  it("correctly classifies a Postgres-style `+00:00` timestamp at the boundary", () => {
    expect(
      isInLocalDay("2026-05-12T07:00:00+00:00", dayStart, dayEnd),
    ).toBe(true);
  });

  it("correctly classifies a Postgres-style timestamp inside the window", () => {
    expect(
      isInLocalDay("2026-05-12T14:30:00+00:00", dayStart, dayEnd),
    ).toBe(true);
  });

  it("handles fractional-second precision from Postgres (`.123456+00:00`)", () => {
    expect(
      isInLocalDay("2026-05-12T07:00:00.123456+00:00", dayStart, dayEnd),
    ).toBe(true);
  });

  it("returns false for a Postgres-style timestamp on the prior day", () => {
    expect(
      isInLocalDay("2026-05-12T06:59:59+00:00", dayStart, dayEnd),
    ).toBe(false);
  });

  it("returns false for a Postgres-style timestamp on the next day", () => {
    expect(
      isInLocalDay("2026-05-13T07:00:00+00:00", dayStart, dayEnd),
    ).toBe(false);
  });

  it("handles non-UTC offsets correctly (instant-based, not wall-clock)", () => {
    // 2026-05-12 03:00 EDT == 07:00 UTC == start of the window.
    expect(
      isInLocalDay("2026-05-12T03:00:00-04:00", dayStart, dayEnd),
    ).toBe(true);
  });
});
