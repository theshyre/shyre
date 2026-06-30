import { describe, it, expect } from "vitest";
import { isProjectOverdue, todayLocalDate } from "./lifecycle";

describe("isProjectOverdue", () => {
  const TODAY = "2026-06-30";

  it("is false when there is no projected end date", () => {
    expect(isProjectOverdue(null, "active", TODAY)).toBe(false);
    expect(isProjectOverdue(undefined, "active", TODAY)).toBe(false);
    expect(isProjectOverdue("", "active", TODAY)).toBe(false);
  });

  it("is true for a live project whose projected end has passed", () => {
    expect(isProjectOverdue("2026-06-29", "active", TODAY)).toBe(true);
    expect(isProjectOverdue("2026-01-01", "paused", TODAY)).toBe(true);
  });

  it("is false on the projected-end day itself (not yet overdue)", () => {
    expect(isProjectOverdue(TODAY, "active", TODAY)).toBe(false);
  });

  it("is false when the projected end is in the future", () => {
    expect(isProjectOverdue("2026-07-01", "active", TODAY)).toBe(false);
  });

  it("is never overdue for terminal statuses, even past the date", () => {
    expect(isProjectOverdue("2026-01-01", "completed", TODAY)).toBe(false);
    expect(isProjectOverdue("2026-01-01", "archived", TODAY)).toBe(false);
  });

  it("is false for unknown / null status past the date (only active/paused count)", () => {
    expect(isProjectOverdue("2026-01-01", null, TODAY)).toBe(false);
    expect(isProjectOverdue("2026-01-01", "something", TODAY)).toBe(false);
  });

  it("defaults today to the real local date when omitted", () => {
    // A date far in the past is overdue regardless of the real clock.
    expect(isProjectOverdue("2000-01-01", "active")).toBe(true);
    // A date far in the future never is.
    expect(isProjectOverdue("2999-01-01", "active")).toBe(false);
  });
});

describe("todayLocalDate", () => {
  it("returns a zero-padded ISO YYYY-MM-DD string", () => {
    expect(todayLocalDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
