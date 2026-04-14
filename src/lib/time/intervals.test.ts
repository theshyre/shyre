import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDayRange,
  getMonthRange,
  parseIntervalParams,
  intervalToSearchParams,
  shiftInterval,
  intervalFromToday,
  formatIntervalLabel,
} from "./intervals";

describe("intervals", () => {
  describe("getDayRange", () => {
    it("returns midnight-to-next-midnight", () => {
      const { start, end } = getDayRange(new Date(2026, 3, 15, 14, 30));
      expect(start.getHours()).toBe(0);
      expect(start.getDate()).toBe(15);
      expect(end.getDate()).toBe(16);
      expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
    });
  });

  describe("getMonthRange", () => {
    it("returns first-of-month to first-of-next-month", () => {
      const { start, end } = getMonthRange(new Date(2026, 3, 15));
      expect(start.getDate()).toBe(1);
      expect(start.getMonth()).toBe(3);
      expect(end.getDate()).toBe(1);
      expect(end.getMonth()).toBe(4);
    });

    it("handles December → January rollover", () => {
      const { start, end } = getMonthRange(new Date(2026, 11, 15));
      expect(start.getMonth()).toBe(11);
      expect(start.getFullYear()).toBe(2026);
      expect(end.getMonth()).toBe(0);
      expect(end.getFullYear()).toBe(2027);
    });
  });

  describe("parseIntervalParams", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 3, 15, 12, 0)); // Wed Apr 15 2026
    });
    afterEach(() => vi.useRealTimers());

    it("defaults to week-of-today when no params", () => {
      const r = parseIntervalParams({});
      expect(r.kind).toBe("week");
      expect(r.start.getDay()).toBe(1); // Monday
      expect(r.start.getDate()).toBe(13);
    });

    it("honors interval=day with anchor", () => {
      const r = parseIntervalParams({ interval: "day", anchor: "2026-04-15" });
      expect(r.kind).toBe("day");
      expect(r.start.getDate()).toBe(15);
    });

    it("honors interval=month with anchor", () => {
      const r = parseIntervalParams({ interval: "month", anchor: "2026-04-15" });
      expect(r.kind).toBe("month");
      expect(r.start.getDate()).toBe(1);
      expect(r.end.getMonth()).toBe(4);
    });

    it("honors interval=custom with from/to", () => {
      const r = parseIntervalParams({
        interval: "custom",
        from: "2026-04-10",
        to: "2026-04-20",
      });
      expect(r.kind).toBe("custom");
      expect(r.start.getDate()).toBe(10);
      // end is exclusive, so one day after "to"
      expect(r.end.getDate()).toBe(21);
    });

    it("falls back to week when custom has invalid range", () => {
      const r = parseIntervalParams({
        interval: "custom",
        from: "2026-04-20",
        to: "2026-04-10",
      });
      expect(r.kind).toBe("week");
    });

    it("falls back to week for invalid interval value", () => {
      const r = parseIntervalParams({ interval: "gibberish" });
      expect(r.kind).toBe("week");
    });

    it("falls back to today when anchor is invalid", () => {
      const r = parseIntervalParams({ interval: "day", anchor: "nope" });
      expect(r.kind).toBe("day");
      expect(r.start.getDate()).toBe(15); // today
    });
  });

  describe("intervalToSearchParams", () => {
    it("encodes day interval with anchor", () => {
      const existing = new URLSearchParams("org=o1");
      const p = intervalToSearchParams(existing, {
        kind: "day",
        start: new Date(2026, 3, 15),
        end: new Date(2026, 3, 16),
      });
      expect(p.get("interval")).toBe("day");
      expect(p.get("anchor")).toBe("2026-04-15");
      expect(p.get("org")).toBe("o1");
      expect(p.get("from")).toBeNull();
    });

    it("encodes custom interval with from/to (to is inclusive)", () => {
      const p = intervalToSearchParams(new URLSearchParams(), {
        kind: "custom",
        start: new Date(2026, 3, 10),
        end: new Date(2026, 3, 21), // exclusive
      });
      expect(p.get("interval")).toBe("custom");
      expect(p.get("from")).toBe("2026-04-10");
      expect(p.get("to")).toBe("2026-04-20");
      expect(p.get("anchor")).toBeNull();
    });

    it("strips stale params when switching interval kinds", () => {
      const existing = new URLSearchParams("interval=custom&from=2026-04-10&to=2026-04-20");
      const p = intervalToSearchParams(existing, {
        kind: "week",
        start: new Date(2026, 3, 13),
        end: new Date(2026, 3, 20),
      });
      expect(p.get("from")).toBeNull();
      expect(p.get("to")).toBeNull();
      expect(p.get("anchor")).toBe("2026-04-13");
    });
  });

  describe("shiftInterval", () => {
    it("shifts day by 1 day", () => {
      const cur = { kind: "day" as const, start: new Date(2026, 3, 15), end: new Date(2026, 3, 16) };
      const next = shiftInterval(cur, 1);
      expect(next.start.getDate()).toBe(16);
    });

    it("shifts week by 7 days", () => {
      const cur = { kind: "week" as const, start: new Date(2026, 3, 13), end: new Date(2026, 3, 20) };
      const next = shiftInterval(cur, 1);
      expect(next.start.getDate()).toBe(20);
    });

    it("shifts month by 1 month", () => {
      const cur = { kind: "month" as const, start: new Date(2026, 3, 1), end: new Date(2026, 4, 1) };
      const next = shiftInterval(cur, 1);
      expect(next.start.getMonth()).toBe(4);
      const prev = shiftInterval(cur, -1);
      expect(prev.start.getMonth()).toBe(2);
    });

    it("shifts custom by the same range length", () => {
      const cur = {
        kind: "custom" as const,
        start: new Date(2026, 3, 10),
        end: new Date(2026, 3, 21), // 11 days
      };
      const next = shiftInterval(cur, 1);
      const diff = (next.start.getTime() - cur.start.getTime()) / (1000 * 3600 * 24);
      expect(diff).toBe(11);
    });
  });

  describe("intervalFromToday", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 3, 15, 12, 0)); // Wed
    });
    afterEach(() => vi.useRealTimers());

    it("creates today's interval for each kind", () => {
      expect(intervalFromToday("day").start.getDate()).toBe(15);
      expect(intervalFromToday("week").start.getDate()).toBe(13);
      expect(intervalFromToday("month").start.getDate()).toBe(1);
    });

    it("creates a 7-day custom interval ending today", () => {
      const r = intervalFromToday("custom");
      expect(r.kind).toBe("custom");
      // 7 days: Apr 9..Apr 15 inclusive
      expect(r.start.getDate()).toBe(9);
      expect(r.end.getDate()).toBe(16); // exclusive
    });
  });

  describe("formatIntervalLabel", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 3, 15, 12, 0));
    });
    afterEach(() => vi.useRealTimers());

    it("labels today as 'Today'", () => {
      const r = { kind: "day" as const, start: new Date(2026, 3, 15), end: new Date(2026, 3, 16) };
      expect(formatIntervalLabel(r)).toBe("Today");
    });

    it("labels a non-today day", () => {
      const r = { kind: "day" as const, start: new Date(2026, 3, 10), end: new Date(2026, 3, 11) };
      expect(formatIntervalLabel(r, "en-US")).toMatch(/Apr\s*10/);
    });

    it("labels a month as 'April 2026'", () => {
      const r = { kind: "month" as const, start: new Date(2026, 3, 1), end: new Date(2026, 4, 1) };
      expect(formatIntervalLabel(r, "en-US")).toBe("April 2026");
    });

    it("labels a week as a range", () => {
      const r = { kind: "week" as const, start: new Date(2026, 3, 13), end: new Date(2026, 3, 20) };
      const label = formatIntervalLabel(r, "en-US");
      expect(label).toMatch(/Apr\s*13/);
      expect(label).toContain("–");
      expect(label).toMatch(/19/);
    });
  });
});
