import { describe, it, expect } from "vitest";
import {
  resolveReportsPeriod,
  thisMonth,
  lastMonth,
  thisQuarter,
  lastQuarter,
  thisYear,
} from "./reports-period";

const T = (iso: string): Date => new Date(iso);

describe("resolveReportsPeriod", () => {
  it("defaults to this-month-to-date when no params are present", () => {
    const r = resolveReportsPeriod({}, T("2026-05-04T00:00:00Z"));
    expect(r.preset).toBe("this_month");
    expect(r.from).toBe("2026-05-01");
    expect(r.to).toBe("2026-05-04");
  });

  it("honors a valid from/to pair as a custom range", () => {
    const r = resolveReportsPeriod(
      { from: "2026-01-01", to: "2026-03-31" },
      T("2026-05-04T00:00:00Z"),
    );
    expect(r.preset).toBe("custom");
    expect(r.from).toBe("2026-01-01");
    expect(r.to).toBe("2026-03-31");
  });

  it("rejects malformed dates and falls back to this-month-to-date", () => {
    const r = resolveReportsPeriod(
      { from: "not-a-date", to: "2026-03-31" },
      T("2026-05-04T00:00:00Z"),
    );
    expect(r.preset).toBe("this_month");
  });

  it("rejects from > to and falls back to default", () => {
    const r = resolveReportsPeriod(
      { from: "2026-04-30", to: "2026-04-01" },
      T("2026-05-04T00:00:00Z"),
    );
    expect(r.preset).toBe("this_month");
  });

  it("preset wins over from/to when both are present", () => {
    const r = resolveReportsPeriod(
      { from: "2026-01-01", to: "2026-03-31", preset: "this_year" },
      T("2026-05-04T00:00:00Z"),
    );
    expect(r.preset).toBe("this_year");
    expect(r.from).toBe("2026-01-01");
    expect(r.to).toBe("2026-05-04");
  });
});

describe("preset helpers", () => {
  const today = T("2026-05-04T12:00:00Z"); // a Monday

  it("thisMonth covers the 1st to today", () => {
    expect(thisMonth(today)).toEqual({ from: "2026-05-01", to: "2026-05-04" });
  });

  it("lastMonth covers the full prior calendar month", () => {
    expect(lastMonth(today)).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("lastMonth handles year wrap (Jan → previous Dec)", () => {
    expect(lastMonth(T("2026-01-15T00:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("thisQuarter (May → Q2) starts at April 1", () => {
    expect(thisQuarter(today)).toEqual({
      from: "2026-04-01",
      to: "2026-05-04",
    });
  });

  it("lastQuarter (May → Q1) is Jan 1–Mar 31", () => {
    expect(lastQuarter(today)).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
  });

  it("lastQuarter handles year wrap (Jan → prior Q4)", () => {
    expect(lastQuarter(T("2026-02-10T00:00:00Z"))).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
  });

  it("thisYear is Jan 1 → today", () => {
    expect(thisYear(today)).toEqual({ from: "2026-01-01", to: "2026-05-04" });
  });
});
