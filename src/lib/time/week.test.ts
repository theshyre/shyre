import { describe, it, expect } from "vitest";
import {
  getWeekStart,
  getWeekRange,
  isoWeekParam,
  parseWeekParam,
  groupEntriesByDay,
  formatDurationShort,
  formatDurationHM,
  formatDurationHMZero,
  parseDurationInput,
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

  describe("formatDurationHM", () => {
    it("formats as H:MM with zero-padded minutes", () => {
      expect(formatDurationHM(null)).toBe("—");
      expect(formatDurationHM(0)).toBe("—");
      expect(formatDurationHM(5)).toBe("0:05");
      expect(formatDurationHM(45)).toBe("0:45");
      expect(formatDurationHM(60)).toBe("1:00");
      expect(formatDurationHM(195)).toBe("3:15");
      expect(formatDurationHM(720)).toBe("12:00");
    });
  });

  describe("formatDurationHMZero", () => {
    it("uses 0:00 for null/zero instead of em-dash", () => {
      expect(formatDurationHMZero(null)).toBe("0:00");
      expect(formatDurationHMZero(undefined)).toBe("0:00");
      expect(formatDurationHMZero(0)).toBe("0:00");
      expect(formatDurationHMZero(75)).toBe("1:15");
    });
  });

  describe("parseDurationInput", () => {
    it("parses H:MM form", () => {
      expect(parseDurationInput("3:15")).toBe(195);
      expect(parseDurationInput("0:45")).toBe(45);
      expect(parseDurationInput("12:00")).toBe(720);
    });

    it("parses Hh Mm form", () => {
      expect(parseDurationInput("3h 15m")).toBe(195);
      expect(parseDurationInput("3h")).toBe(180);
      expect(parseDurationInput("45m")).toBe(45);
      expect(parseDurationInput("2h30m")).toBe(150);
    });

    it("parses decimal hours", () => {
      expect(parseDurationInput("3.25")).toBe(195);
      expect(parseDurationInput("0.5")).toBe(30);
      expect(parseDurationInput(".5")).toBe(30);
      expect(parseDurationInput("3,25")).toBe(195); // European decimal
    });

    it("treats bare integers < 24 as hours (Harvest convention)", () => {
      expect(parseDurationInput("3")).toBe(180);
      expect(parseDurationInput("0")).toBe(0);
    });

    it("empty string → 0", () => {
      expect(parseDurationInput("")).toBe(0);
      expect(parseDurationInput("   ")).toBe(0);
    });

    it("rejects nonsense as null", () => {
      expect(parseDurationInput("abc")).toBeNull();
      expect(parseDurationInput("3:99")).toBeNull(); // minutes must be 0-59
      expect(parseDurationInput("--")).toBeNull();
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
