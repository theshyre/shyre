/**
 * Pure compute for the sub-projects rollup section. Extracted from
 * the React server component so the math (parent + child minutes,
 * budget aggregation, dollar conversion with rate fallback,
 * per-child burn percentage) is testable without spinning up a
 * Supabase fixture.
 *
 * The component still owns the SQL aggregation and the rendering;
 * this file only owns the arithmetic that turns "minutes by child id"
 * into "rollup totals + per-child rows."
 *
 * Invariants this preserves vs. the prior inline math:
 *   - Per-child burn % caps at 100 so an over-budget bar never
 *     overflows the track. Returns null when there's no budget so
 *     the bar can hide entirely instead of rendering 0%.
 *   - Per-child dollar uses the child's own rate when set, else
 *     falls back to the parent's rate. A parent with no rate
 *     resolves to 0 across the board (no fake "infinite money").
 *   - Total minutes / hours / budget always sum parent OWN + every
 *     child — never just children — so the rolled-up card and the
 *     parent's primary totals card can't disagree.
 */

export interface SubProjectRollupChild {
  id: string;
  hourly_rate: number | null;
  budget_hours: number | null;
}

export interface SubProjectRollupRow {
  /** Minutes summed for this child. 0 when the child has no entries. */
  minutes: number;
  /** Convenience: minutes / 60. */
  hours: number;
  /** Pass-through of the child's `budget_hours` (null when unset). */
  budget: number | null;
  /** Burn % capped at 100. null when budget is null/0. */
  pct: number | null;
  /**
   * Per-child rate after fallback to parent's rate. Surfaced for
   * downstream rendering / debugging; the rollup dollar totals
   * already use it internally.
   */
  effectiveRate: number;
}

export interface SubProjectRollupTotals {
  minutes: number;
  hours: number;
  /** Parent budget + Σ child budgets. 0 when no budgets are set
   *  anywhere in the tree (caller can treat 0 as "no budget"). */
  budgetHours: number;
  /** parent_rate × parent_own_hours + Σ effective_rate × child_hours. */
  dollars: number;
  /** Same shape as `dollars` but multiplied by budgets instead of
   *  actuals. 0 when no budgets are set. */
  budgetDollars: number;
}

export interface SubProjectRollupResult<T extends SubProjectRollupChild> {
  /** Each input child preserved with the computed rollup fields
   *  spread on top. Generic so the caller's `name`, `status`, etc.
   *  fields stay typed. */
  childRows: Array<T & SubProjectRollupRow>;
  totals: SubProjectRollupTotals;
}

export interface SubProjectRollupInput<T extends SubProjectRollupChild> {
  parentBudgetHours: number | null;
  parentHourlyRate: number | null;
  /** Pre-aggregated minutes for the parent's OWN time entries —
   *  computed by the caller higher up the page so this rollup and
   *  the page's primary totals card share one number. */
  parentOwnMinutes: number;
  children: T[];
  /** Lookup of summed minutes per child id. Missing keys are treated
   *  as 0 (a child with no entries is a valid state). */
  minutesByChildId: ReadonlyMap<string, number>;
}

export function computeSubProjectsRollup<T extends SubProjectRollupChild>(
  input: SubProjectRollupInput<T>,
): SubProjectRollupResult<T> {
  const {
    parentBudgetHours,
    parentHourlyRate,
    parentOwnMinutes,
    children,
    minutesByChildId,
  } = input;

  const parentRate = parentHourlyRate ?? 0;

  const childRows = children.map((c) => {
    const minutes = minutesByChildId.get(c.id) ?? 0;
    const hours = minutes / 60;
    const budget = c.budget_hours;
    const pct =
      budget && budget > 0 ? Math.min(100, (hours / budget) * 100) : null;
    const effectiveRate = c.hourly_rate ?? parentRate;
    return {
      ...c,
      minutes,
      hours,
      budget,
      pct,
      effectiveRate,
    };
  });

  const childMinutesTotal = childRows.reduce((s, r) => s + r.minutes, 0);
  const totalMinutes = parentOwnMinutes + childMinutesTotal;
  const totalHours = totalMinutes / 60;
  const childBudgetTotal = childRows.reduce(
    (s, r) => s + (r.budget ?? 0),
    0,
  );
  const totalBudget = (parentBudgetHours ?? 0) + childBudgetTotal;

  const totalDollars =
    childRows.reduce(
      (s, r) => s + (r.minutes / 60) * r.effectiveRate,
      0,
    ) +
    (parentOwnMinutes / 60) * parentRate;

  const totalBudgetDollars =
    childRows.reduce(
      (s, r) => s + (r.budget ?? 0) * r.effectiveRate,
      0,
    ) +
    (parentBudgetHours ?? 0) * parentRate;

  return {
    childRows,
    totals: {
      minutes: totalMinutes,
      hours: totalHours,
      budgetHours: totalBudget,
      dollars: totalDollars,
      budgetDollars: totalBudgetDollars,
    },
  };
}
