import { describe, it, expect } from "vitest";
import {
  parseTzOffset,
  getLocalToday,
  getLocalWeekStart,
  addLocalDays,
  localDateMidnightUtc,
  utcToLocalDateStr,
  validateLocalDateStr,
} from "./tz";

describe("parseTzOffset", () => {
  it("returns 0 for missing/blank/invalid", () => {
    expect(parseTzOffset(undefined)).toBe(0);
    expect(parseTzOffset("")).toBe(0);
    expect(parseTzOffset("abc")).toBe(0);
    expect(parseTzOffset("9999")).toBe(0); // out of range
    expect(parseTzOffset("-9999")).toBe(0);
  });

  it("parses reasonable offsets", () => {
    expect(parseTzOffset("420")).toBe(420); // PDT
    expect(parseTzOffset("0")).toBe(0); // UTC
    expect(parseTzOffset("-60")).toBe(-60); // CET in summer as UTC+2 = -120? well, just a test
  });
});

describe("getLocalToday", () => {
  it("returns today's local date for PDT", () => {
    // Apr 14 2026 10:00 UTC = Apr 14 2026 03:00 PDT
    const now = Date.UTC(2026, 3, 14, 10, 0, 0);
    expect(getLocalToday(420, now)).toBe("2026-04-14");
  });

  it("handles day-boundary in local TZ", () => {
    // Apr 14 2026 01:00 UTC = Apr 13 2026 18:00 PDT (yesterday!)
    const now = Date.UTC(2026, 3, 14, 1, 0, 0);
    expect(getLocalToday(420, now)).toBe("2026-04-13");
  });

  it("handles a UTC user (offset 0)", () => {
    const now = Date.UTC(2026, 3, 14, 3, 0, 0);
    expect(getLocalToday(0, now)).toBe("2026-04-14");
  });
});

describe("getLocalWeekStart", () => {
  it("Monday returns itself", () => {
    expect(getLocalWeekStart("2026-04-13")).toBe("2026-04-13");
  });

  it("Tuesday snaps back to Monday", () => {
    expect(getLocalWeekStart("2026-04-14")).toBe("2026-04-13");
  });

  it("Sunday snaps back to prior Monday", () => {
    expect(getLocalWeekStart("2026-04-19")).toBe("2026-04-13");
  });

  it("crosses month boundary", () => {
    // Sat May 2 2026 → Mon Apr 27 2026
    expect(getLocalWeekStart("2026-05-02")).toBe("2026-04-27");
  });
});

describe("addLocalDays", () => {
  it("adds and subtracts days", () => {
    expect(addLocalDays("2026-04-13", 1)).toBe("2026-04-14");
    expect(addLocalDays("2026-04-13", 7)).toBe("2026-04-20");
    expect(addLocalDays("2026-04-13", -1)).toBe("2026-04-12");
  });

  it("crosses month boundary", () => {
    expect(addLocalDays("2026-04-30", 1)).toBe("2026-05-01");
    expect(addLocalDays("2026-05-01", -1)).toBe("2026-04-30");
  });
});

describe("localDateMidnightUtc", () => {
  it("PDT user: local midnight = 07:00 UTC", () => {
    const utc = localDateMidnightUtc("2026-04-13", 420);
    expect(utc.toISOString()).toBe("2026-04-13T07:00:00.000Z");
  });

  it("UTC user: local midnight = 00:00 UTC", () => {
    const utc = localDateMidnightUtc("2026-04-13", 0);
    expect(utc.toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  it("JST user (UTC+9, offset -540): local midnight = 15:00 UTC prior day", () => {
    const utc = localDateMidnightUtc("2026-04-13", -540);
    expect(utc.toISOString()).toBe("2026-04-12T15:00:00.000Z");
  });
});

describe("utcToLocalDateStr", () => {
  it("PDT: 2026-04-13T07:00Z → 2026-04-13", () => {
    expect(utcToLocalDateStr("2026-04-13T07:00:00.000Z", 420)).toBe("2026-04-13");
  });

  it("PDT: 2026-04-14T02:00Z is still Apr 13 in PDT (7pm)", () => {
    expect(utcToLocalDateStr("2026-04-14T02:00:00.000Z", 420)).toBe("2026-04-13");
  });

  it("PDT: 2026-04-14T07:00Z is exactly Apr 14 midnight in PDT", () => {
    expect(utcToLocalDateStr("2026-04-14T07:00:00.000Z", 420)).toBe("2026-04-14");
  });

  it("UTC user: no shift", () => {
    expect(utcToLocalDateStr("2026-04-14T00:00:00.000Z", 0)).toBe("2026-04-14");
  });
});

describe("validateLocalDateStr", () => {
  it("accepts valid YYYY-MM-DD", () => {
    expect(validateLocalDateStr("2026-04-13")).toBe("2026-04-13");
  });

  it("rejects missing/empty/malformed", () => {
    expect(validateLocalDateStr(undefined)).toBeNull();
    expect(validateLocalDateStr("")).toBeNull();
    expect(validateLocalDateStr("2026-4-13")).toBeNull(); // not zero-padded
    expect(validateLocalDateStr("2026-13-01")).toBeNull();
    expect(validateLocalDateStr("2026-02-30")).toBeNull();
  });
});
