/**
 * Fixed-bid profitability math — "did we hit the number?".
 *
 * A fixed-bid project is priced up front; time is tracked to see how the actual
 * effort compares to the quoted price. The headline is the EFFECTIVE realized
 * rate (price ÷ hours) — the $/hr you actually earned. Optional variance vs the
 * hours you budgeted when you scoped it. (Margin — price minus labor COST —
 * needs a cost rate Shyre doesn't have yet; that's a later phase. This is
 * revenue ÷ hours only, no cost concept.)
 *
 * Pure so it's deterministic to test.
 */

export interface FixedBidStats {
  /** Hours spent (minutes / 60). */
  hours: number;
  /** fixedPrice ÷ hours — the realized $/hr. Null when no hours logged yet. */
  effectiveRate: number | null;
  /** hours > budgetHours. Null when no (or zero) budget estimate is set. */
  overBudgetHours: boolean | null;
  /** (hours − budgetHours) / budgetHours × 100. Null when no/zero budget. */
  hoursVariancePct: number | null;
}

export function fixedBidStats(
  fixedPrice: number,
  minutes: number,
  budgetHours: number | null,
): FixedBidStats {
  const hours = minutes / 60;
  const effectiveRate = hours > 0 ? fixedPrice / hours : null;
  const hasBudget = budgetHours != null && budgetHours > 0;
  return {
    hours,
    effectiveRate,
    overBudgetHours: hasBudget ? hours > budgetHours : null,
    hoursVariancePct: hasBudget
      ? ((hours - budgetHours) / budgetHours) * 100
      : null,
  };
}
