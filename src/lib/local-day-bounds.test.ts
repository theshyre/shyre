import { describe, it, expect } from "vitest";
import { localDayBoundsIso } from "./local-day-bounds";

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
