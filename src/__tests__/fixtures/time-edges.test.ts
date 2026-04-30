import { describe, it, expect } from "vitest";
import {
  makeEntry,
  springForwardEntries,
  fallBackEntries,
  nyeEntry,
  leapDayEntry,
  crossMidnightEntry,
  farFutureRunningTimer,
  allEdgeEntries,
  SPRING_FORWARD_UTC_BEFORE,
  SPRING_FORWARD_UTC_AFTER,
  FALL_BACK_UTC_FIRST,
  FALL_BACK_UTC_SECOND,
  NYE_START_UTC,
  NYE_END_UTC,
  LEAP_DAY_UTC,
  CROSS_MIDNIGHT_START_UTC,
  CROSS_MIDNIGHT_END_UTC,
  FAR_FUTURE_START_UTC,
} from "./time-edges";

describe("time-edges fixtures", () => {
  describe("makeEntry factory", () => {
    it("computes duration_min from start/end when not provided", () => {
      const entry = makeEntry({
        id: "x",
        start: new Date("2026-04-15T10:00:00.000Z"),
        end: new Date("2026-04-15T11:30:00.000Z"),
      });
      expect(entry.duration_min).toBe(90);
    });

    it("returns null duration for a running timer (end=null)", () => {
      const entry = makeEntry({
        id: "x",
        start: new Date("2026-04-15T10:00:00.000Z"),
        end: null,
      });
      expect(entry.end_time).toBeNull();
      expect(entry.duration_min).toBeNull();
    });

    it("respects an explicit durationMin override", () => {
      const entry = makeEntry({
        id: "x",
        start: new Date("2026-04-15T10:00:00.000Z"),
        end: new Date("2026-04-15T11:00:00.000Z"),
        durationMin: 42,
      });
      expect(entry.duration_min).toBe(42);
    });

    it("attaches a default author so authorship rule never trips", () => {
      const entry = makeEntry({
        id: "x",
        start: new Date("2026-04-15T10:00:00.000Z"),
      });
      expect(entry.author).not.toBeNull();
      expect(entry.author?.user_id).toBe("u1");
    });

    it("allows overriding team / user / project for cross-team scenarios", () => {
      const entry = makeEntry({
        id: "x",
        start: new Date("2026-04-15T10:00:00.000Z"),
        teamId: "t-other",
        userId: "u-other",
        projectId: "p-other",
      });
      expect(entry.team_id).toBe("t-other");
      expect(entry.user_id).toBe("u-other");
      expect(entry.project_id).toBe("p-other");
    });
  });

  describe("springForwardEntries", () => {
    it("brackets the spring-forward gap with two distinct UTC instants", () => {
      const [before, after] = springForwardEntries();
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(before!.start_time).toBe(SPRING_FORWARD_UTC_BEFORE.toISOString());
      expect(after!.start_time).toBe(SPRING_FORWARD_UTC_AFTER.toISOString());
      // 1h difference — the DST gap itself is 1h
      const diffMs =
        SPRING_FORWARD_UTC_AFTER.getTime() - SPRING_FORWARD_UTC_BEFORE.getTime();
      expect(diffMs).toBe(60 * 60_000);
    });
  });

  describe("fallBackEntries", () => {
    it("represents the two 01:30 occurrences with distinct UTC timestamps", () => {
      const [first, second] = fallBackEntries();
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first!.start_time).not.toBe(second!.start_time);
      expect(first!.start_time).toBe(FALL_BACK_UTC_FIRST.toISOString());
      expect(second!.start_time).toBe(FALL_BACK_UTC_SECOND.toISOString());
      // 1h apart — the fall-back hour is repeated
      const diffMs =
        FALL_BACK_UTC_SECOND.getTime() - FALL_BACK_UTC_FIRST.getTime();
      expect(diffMs).toBe(60 * 60_000);
    });
  });

  describe("nyeEntry", () => {
    it("straddles the year boundary in UTC", () => {
      const entry = nyeEntry();
      expect(entry.start_time).toBe(NYE_START_UTC.toISOString());
      expect(entry.end_time).toBe(NYE_END_UTC.toISOString());
      expect(NYE_START_UTC.getUTCFullYear()).toBe(2025);
      expect(NYE_END_UTC.getUTCFullYear()).toBe(2026);
      expect(entry.duration_min).toBe(45);
    });
  });

  describe("leapDayEntry", () => {
    it("lands on Feb 29, 2024", () => {
      const entry = leapDayEntry();
      expect(entry.start_time).toBe(LEAP_DAY_UTC.toISOString());
      expect(LEAP_DAY_UTC.getUTCFullYear()).toBe(2024);
      expect(LEAP_DAY_UTC.getUTCMonth()).toBe(1); // Feb (0-indexed)
      expect(LEAP_DAY_UTC.getUTCDate()).toBe(29);
    });
  });

  describe("crossMidnightEntry", () => {
    it("crosses a within-year midnight boundary", () => {
      const entry = crossMidnightEntry();
      expect(entry.start_time).toBe(CROSS_MIDNIGHT_START_UTC.toISOString());
      expect(entry.end_time).toBe(CROSS_MIDNIGHT_END_UTC.toISOString());
      expect(CROSS_MIDNIGHT_START_UTC.getUTCDate()).toBe(15);
      expect(CROSS_MIDNIGHT_END_UTC.getUTCDate()).toBe(16);
      expect(entry.duration_min).toBe(60);
    });
  });

  describe("farFutureRunningTimer", () => {
    it("is a running timer (no end, no duration) with a far-future start", () => {
      const entry = farFutureRunningTimer();
      expect(entry.start_time).toBe(FAR_FUTURE_START_UTC.toISOString());
      expect(entry.end_time).toBeNull();
      expect(entry.duration_min).toBeNull();
      expect(FAR_FUTURE_START_UTC.getUTCFullYear()).toBeGreaterThan(2030);
    });
  });

  describe("allEdgeEntries", () => {
    it("returns every edge fixture with unique ids", () => {
      const entries = allEdgeEntries();
      const ids = entries.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(entries.length).toBeGreaterThanOrEqual(7);
    });

    it("every entry carries an author (mandatory authorship rule)", () => {
      for (const e of allEdgeEntries()) {
        expect(e.author).not.toBeNull();
      }
    });
  });
});
