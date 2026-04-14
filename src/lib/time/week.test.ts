import { describe, it, expect } from "vitest";
import {
  getWeekStart,
  getWeekRange,
  isoWeekParam,
  parseWeekParam,
  groupEntriesByDay,
  formatDurationShort,
  sumDurationMin,
  sumBillableMin,
  isSameDay,
  getTodayStart,
} from "./week";

describe("week helpers", () => {
  describe("getWeekStart", () => {
    it("returns Monday for a mid-week date", () => {
      const wed = new Date(2026, 3, 15); // Wed Apr 15 2026
      const monday = getWeekStart(wed);
      expect(monday.getDay()).toBe(1);
      expect(monday.getDate()).toBe(13);
    });

    it("returns same day if given a Monday", () => {
      const mon = new Date(2026, 3, 13);
      const result = getWeekStart(mon);
      expect(result.getDate()).toBe(13);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
    });

    it("handles Sunday correctly (goes back to previous Monday)", () => {
      const sun = new Date(2026, 3, 19); // Sun Apr 19
      const monday = getWeekStart(sun);
      expect(monday.getDay()).toBe(1);
      expect(monday.getDate()).toBe(13); // previous Monday
    });
  });

  describe("getWeekRange", () => {
    it("returns 7-day range", () => {
      const date = new Date(2026, 3, 15);
      const { start, end } = getWeekRange(date);
      const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBe(7);
    });
  });

  describe("isoWeekParam / parseWeekParam", () => {
    it("round trips", () => {
      const date = new Date(2026, 3, 13);
      const param = isoWeekParam(date);
      expect(param).toBe("2026-04-13");
      const parsed = parseWeekParam(param);
      expect(parsed?.getDate()).toBe(13);
    });

    it("parseWeekParam returns null for invalid", () => {
      expect(parseWeekParam(undefined)).toBeNull();
      expect(parseWeekParam("")).toBeNull();
      expect(parseWeekParam("nope")).toBeNull();
      expect(parseWeekParam("2026-13-01")).toBeNull();
    });

    it("parseWeekParam snaps to Monday", () => {
      // 2026-04-15 is a Wednesday; parsing should give us Monday 04-13
      const parsed = parseWeekParam("2026-04-15");
      expect(parsed?.getDay()).toBe(1);
      expect(parsed?.getDate()).toBe(13);
    });
  });

  describe("groupEntriesByDay", () => {
    const weekStart = new Date(2026, 3, 13); // Mon Apr 13

    it("buckets entries by day", () => {
      const entries = [
        {
          id: "1",
          start_time: new Date(2026, 3, 13, 10).toISOString(), // Mon
          end_time: new Date(2026, 3, 13, 11).toISOString(),
          duration_min: 60,
          billable: true,
        },
        {
          id: "2",
          start_time: new Date(2026, 3, 15, 14).toISOString(), // Wed
          end_time: new Date(2026, 3, 15, 15).toISOString(),
          duration_min: 60,
          billable: true,
        },
      ];
      const days = groupEntriesByDay(entries, weekStart);
      expect(days[0]).toHaveLength(1); // Mon
      expect(days[1]).toHaveLength(0); // Tue
      expect(days[2]).toHaveLength(1); // Wed
      expect(days[6]).toHaveLength(0); // Sun
    });

    it("ignores entries outside the week", () => {
      const entries = [
        {
          id: "1",
          start_time: new Date(2026, 3, 6).toISOString(), // prev Mon
          end_time: null,
          duration_min: null,
          billable: true,
        },
        {
          id: "2",
          start_time: new Date(2026, 3, 20).toISOString(), // next Mon
          end_time: null,
          duration_min: null,
          billable: true,
        },
      ];
      const days = groupEntriesByDay(entries, weekStart);
      const total = days.reduce((sum, d) => sum + d.length, 0);
      expect(total).toBe(0);
    });

    it("sorts entries within a day chronologically", () => {
      const entries = [
        {
          id: "later",
          start_time: new Date(2026, 3, 13, 14).toISOString(),
          end_time: null,
          duration_min: null,
          billable: true,
        },
        {
          id: "earlier",
          start_time: new Date(2026, 3, 13, 9).toISOString(),
          end_time: null,
          duration_min: null,
          billable: true,
        },
      ];
      const days = groupEntriesByDay(entries, weekStart);
      expect(days[0]?.[0]?.id).toBe("earlier");
      expect(days[0]?.[1]?.id).toBe("later");
    });
  });

  describe("formatDurationShort", () => {
    it("formats various durations", () => {
      expect(formatDurationShort(null)).toBe("—");
      expect(formatDurationShort(0)).toBe("—");
      expect(formatDurationShort(5)).toBe("5m");
      expect(formatDurationShort(60)).toBe("1h");
      expect(formatDurationShort(90)).toBe("1h 30m");
      expect(formatDurationShort(120)).toBe("2h");
      expect(formatDurationShort(125)).toBe("2h 5m");
    });
  });

  describe("sumDurationMin / sumBillableMin", () => {
    it("sums only completed entries", () => {
      const entries = [
        { id: "1", start_time: "", end_time: "", duration_min: 60, billable: true },
        { id: "2", start_time: "", end_time: "", duration_min: 30, billable: false },
        { id: "3", start_time: "", end_time: null, duration_min: null, billable: true },
      ];
      expect(sumDurationMin(entries)).toBe(90);
      expect(sumBillableMin(entries)).toBe(60);
    });
  });

  describe("isSameDay", () => {
    it("compares dates ignoring time", () => {
      const a = new Date(2026, 3, 13, 10, 0);
      const b = new Date(2026, 3, 13, 23, 59);
      const c = new Date(2026, 3, 14, 0, 0);
      expect(isSameDay(a, b)).toBe(true);
      expect(isSameDay(a, c)).toBe(false);
    });
  });

  describe("getTodayStart", () => {
    it("returns today at midnight", () => {
      const today = getTodayStart();
      expect(today.getHours()).toBe(0);
      expect(today.getMinutes()).toBe(0);
      expect(today.getSeconds()).toBe(0);
    });
  });
});
