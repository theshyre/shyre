import { describe, it, expect } from "vitest";
import {
  computeCurrentPeriodBounds,
  computePreviousPeriodBounds,
  computeProjectPeriodBurn,
  sumMinutesInPeriod,
} from "./budget-period";

const TZ_PT = 480; // PST — minutes WEST of UTC

describe("computeCurrentPeriodBounds — monthly", () => {
  it("returns the calendar month containing the anchor date (start-of-month → start-of-next-month)", () => {
    const b = computeCurrentPeriodBounds("monthly", "2026-04-15", TZ_PT);
    expect(b.startLocal).toBe("2026-04-01");
    expect(b.endLocal).toBe("2026-05-01");
  });

  it("anchored on day-1 returns the same month (boundaries inclusive of start, exclusive of end)", () => {
    const b = computeCurrentPeriodBounds("monthly", "2026-04-01", TZ_PT);
    expect(b.startLocal).toBe("2026-04-01");
    expect(b.endLocal).toBe("2026-05-01");
  });

  it("rolls year on December → January", () => {
    const b = computeCurrentPeriodBounds("monthly", "2026-12-31", TZ_PT);
    expect(b.startLocal).toBe("2026-12-01");
    expect(b.endLocal).toBe("2027-01-01");
  });

  it("UTC bounds reflect the user's TZ offset (PST → 8h ahead of local)", () => {
    const b = computeCurrentPeriodBounds("monthly", "2026-04-15", TZ_PT);
    // localDateMidnightUtc applies the offset literally (no DST
    // resolution mid-period) — both bounds use the same `tzOffsetMin`.
    // April 1, 00:00 in TZ-480 zone = April 1, 08:00 UTC.
    expect(b.startUtc.toISOString()).toBe("2026-04-01T08:00:00.000Z");
    expect(b.endUtc.toISOString()).toBe("2026-05-01T08:00:00.000Z");
  });
});

describe("computeCurrentPeriodBounds — weekly", () => {
  it("returns Monday → next Monday for any anchor in the week", () => {
    // Wednesday 2026-04-15 → week starts Mon 2026-04-13
    const b = computeCurrentPeriodBounds("weekly", "2026-04-15", TZ_PT);
    expect(b.startLocal).toBe("2026-04-13");
    expect(b.endLocal).toBe("2026-04-20");
  });

  it("anchor on a Monday returns that Monday's week", () => {
    const b = computeCurrentPeriodBounds("weekly", "2026-04-13", TZ_PT);
    expect(b.startLocal).toBe("2026-04-13");
    expect(b.endLocal).toBe("2026-04-20");
  });

  it("anchor on a Sunday returns the week ending that Sunday", () => {
    const b = computeCurrentPeriodBounds("weekly", "2026-04-19", TZ_PT);
    expect(b.startLocal).toBe("2026-04-13");
    expect(b.endLocal).toBe("2026-04-20");
  });
});

describe("computeCurrentPeriodBounds — quarterly", () => {
  it("Q2 = Apr/May/Jun (anchor 2026-04-15)", () => {
    const b = computeCurrentPeriodBounds("quarterly", "2026-04-15", TZ_PT);
    expect(b.startLocal).toBe("2026-04-01");
    expect(b.endLocal).toBe("2026-07-01");
  });

  it("Q1 = Jan/Feb/Mar (anchor 2026-01-31)", () => {
    const b = computeCurrentPeriodBounds("quarterly", "2026-01-31", TZ_PT);
    expect(b.startLocal).toBe("2026-01-01");
    expect(b.endLocal).toBe("2026-04-01");
  });

  it("Q4 rolls year on the upper bound (anchor 2026-12-15)", () => {
    const b = computeCurrentPeriodBounds("quarterly", "2026-12-15", TZ_PT);
    expect(b.startLocal).toBe("2026-10-01");
    expect(b.endLocal).toBe("2027-01-01");
  });
});

describe("computePreviousPeriodBounds", () => {
  it("monthly: April → March", () => {
    const b = computePreviousPeriodBounds("monthly", "2026-04-15", TZ_PT);
    expect(b.startLocal).toBe("2026-03-01");
    expect(b.endLocal).toBe("2026-04-01");
  });

  it("weekly: returns the prior Monday-Sunday", () => {
    const b = computePreviousPeriodBounds("weekly", "2026-04-15", TZ_PT);
    expect(b.startLocal).toBe("2026-04-06");
    expect(b.endLocal).toBe("2026-04-13");
  });

  it("quarterly: Q2 → Q1 (Apr → prior Mar = Q1)", () => {
    const b = computePreviousPeriodBounds("quarterly", "2026-04-15", TZ_PT);
    expect(b.startLocal).toBe("2026-01-01");
    expect(b.endLocal).toBe("2026-04-01");
  });
});

describe("sumMinutesInPeriod", () => {
  const inWindow = (mins: number, iso: string) => ({
    start_time: iso,
    duration_min: mins,
  });

  it("sums entries whose start_time is in [start, end)", () => {
    const start = new Date("2026-04-01T08:00:00Z");
    const end = new Date("2026-05-01T07:00:00Z");
    const total = sumMinutesInPeriod(
      [
        inWindow(60, "2026-04-02T15:00:00Z"),
        inWindow(120, "2026-04-15T22:00:00Z"),
        inWindow(30, "2026-04-30T22:00:00Z"),
      ],
      start,
      end,
    );
    expect(total).toBe(60 + 120 + 30);
  });

  it("excludes entries before the window start", () => {
    const start = new Date("2026-04-01T08:00:00Z");
    const end = new Date("2026-05-01T07:00:00Z");
    const total = sumMinutesInPeriod(
      [inWindow(60, "2026-03-31T22:00:00Z")],
      start,
      end,
    );
    expect(total).toBe(0);
  });

  it("excludes entries at-or-after the window end (exclusive upper bound)", () => {
    const start = new Date("2026-04-01T08:00:00Z");
    const end = new Date("2026-05-01T07:00:00Z");
    const total = sumMinutesInPeriod(
      [inWindow(60, "2026-05-01T07:00:00Z")],
      start,
      end,
    );
    expect(total).toBe(0);
  });

  it("treats null duration as 0 (entry counts in window but adds nothing)", () => {
    const start = new Date("2026-04-01T08:00:00Z");
    const end = new Date("2026-05-01T07:00:00Z");
    const total = sumMinutesInPeriod(
      [
        { start_time: "2026-04-15T15:00:00Z", duration_min: null },
        inWindow(45, "2026-04-15T15:30:00Z"),
      ],
      start,
      end,
    );
    expect(total).toBe(45);
  });
});

describe("computeProjectPeriodBurn", () => {
  const baseEntries = [
    { start_time: "2026-04-15T17:00:00Z", duration_min: 600 }, // 10h
    { start_time: "2026-04-20T17:00:00Z", duration_min: 480 }, // 8h
    { start_time: "2026-03-25T17:00:00Z", duration_min: 240 }, // 4h, prior month
  ];

  it("returns null when the project has no recurring period", () => {
    const r = computeProjectPeriodBurn({
      budget_period: null,
      budget_hours_per_period: 30,
      budget_dollars_per_period: null,
      budget_alert_threshold_pct: 80,
      effectiveRate: 200,
      entries: baseEntries,
      anchorLocalDate: "2026-04-15",
      tzOffsetMin: TZ_PT,
    });
    expect(r).toBeNull();
  });

  it("sums minutes only inside the current period (March entry excluded for an April anchor)", () => {
    const r = computeProjectPeriodBurn({
      budget_period: "monthly",
      budget_hours_per_period: 30,
      budget_dollars_per_period: null,
      budget_alert_threshold_pct: null,
      effectiveRate: 200,
      entries: baseEntries,
      anchorLocalDate: "2026-04-15",
      tzOffsetMin: TZ_PT,
    });
    expect(r?.minutes).toBe(600 + 480);
    expect(r?.hours).toBe(18);
    expect(r?.pctHours).toBe(60); // 18/30 = 60%
    expect(r?.alertActive).toBe(false); // threshold null
  });

  it("alertActive=true when burn meets threshold (60% >= 60% threshold)", () => {
    const r = computeProjectPeriodBurn({
      budget_period: "monthly",
      budget_hours_per_period: 30,
      budget_dollars_per_period: null,
      budget_alert_threshold_pct: 60,
      effectiveRate: 200,
      entries: baseEntries,
      anchorLocalDate: "2026-04-15",
      tzOffsetMin: TZ_PT,
    });
    expect(r?.alertActive).toBe(true);
  });

  it("alertActive=false when burn is below threshold", () => {
    const r = computeProjectPeriodBurn({
      budget_period: "monthly",
      budget_hours_per_period: 30,
      budget_dollars_per_period: null,
      budget_alert_threshold_pct: 90,
      effectiveRate: 200,
      entries: baseEntries,
      anchorLocalDate: "2026-04-15",
      tzOffsetMin: TZ_PT,
    });
    // 18/30 = 60% < 90%
    expect(r?.alertActive).toBe(false);
  });

  it("alertActive triggers off the dollar cap when the dollar burn crosses threshold (even if hours don't)", () => {
    const r = computeProjectPeriodBurn({
      budget_period: "monthly",
      budget_hours_per_period: null, // no hours cap
      budget_dollars_per_period: 3000, // 18h × $200 = $3,600 → 120% — over
      budget_alert_threshold_pct: 80,
      effectiveRate: 200,
      entries: baseEntries,
      anchorLocalDate: "2026-04-15",
      tzOffsetMin: TZ_PT,
    });
    expect(r?.alertActive).toBe(true);
  });

  it("pctHours caps at 999 so over-budget renders legibly without overflowing", () => {
    const r = computeProjectPeriodBurn({
      budget_period: "monthly",
      budget_hours_per_period: 0.001,
      budget_dollars_per_period: null,
      budget_alert_threshold_pct: null,
      effectiveRate: null,
      entries: baseEntries,
      anchorLocalDate: "2026-04-15",
      tzOffsetMin: TZ_PT,
    });
    expect(r?.pctHours).toBe(999);
  });

  it("returns null pctHours when capHours is null or 0 (no divide-by-zero, no fake 100%)", () => {
    const r1 = computeProjectPeriodBurn({
      budget_period: "monthly",
      budget_hours_per_period: null,
      budget_dollars_per_period: 5000,
      budget_alert_threshold_pct: 80,
      effectiveRate: 200,
      entries: baseEntries,
      anchorLocalDate: "2026-04-15",
      tzOffsetMin: TZ_PT,
    });
    expect(r1?.pctHours).toBeNull();

    const r2 = computeProjectPeriodBurn({
      budget_period: "monthly",
      budget_hours_per_period: 0,
      budget_dollars_per_period: null,
      budget_alert_threshold_pct: null,
      effectiveRate: null,
      entries: baseEntries,
      anchorLocalDate: "2026-04-15",
      tzOffsetMin: TZ_PT,
    });
    expect(r2?.pctHours).toBeNull();
  });
});
