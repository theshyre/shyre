import { describe, it, expect } from "vitest";
import { fixedBidStats } from "./fixed-bid";

describe("fixedBidStats", () => {
  it("computes the effective realized rate (price ÷ hours)", () => {
    // $2,500 over 18h → $138.89/h
    const s = fixedBidStats(2500, 18 * 60, null);
    expect(s.hours).toBe(18);
    expect(s.effectiveRate).toBeCloseTo(138.888, 2);
    expect(s.overBudgetHours).toBeNull();
    expect(s.hoursVariancePct).toBeNull();
  });

  it("returns a null rate with no hours yet (no divide-by-zero)", () => {
    const s = fixedBidStats(4000, 0, null);
    expect(s.hours).toBe(0);
    expect(s.effectiveRate).toBeNull();
  });

  it("flags OVER the budgeted-hours estimate", () => {
    // 25h spent vs a 20h estimate → over by 25%
    const s = fixedBidStats(4000, 25 * 60, 20);
    expect(s.overBudgetHours).toBe(true);
    expect(s.hoursVariancePct).toBeCloseTo(25, 5);
  });

  it("flags UNDER the budgeted-hours estimate", () => {
    // 15h spent vs a 20h estimate → under by 25%
    const s = fixedBidStats(4000, 15 * 60, 20);
    expect(s.overBudgetHours).toBe(false);
    expect(s.hoursVariancePct).toBeCloseTo(-25, 5);
  });

  it("treats a zero / null budget as 'no estimate' (variance null)", () => {
    expect(fixedBidStats(1000, 600, 0).overBudgetHours).toBeNull();
    expect(fixedBidStats(1000, 600, null).hoursVariancePct).toBeNull();
  });
});
