/**
 * Period-boundary + per-period burn math for project recurring
 * budgets. Pure compute — no Supabase, no React. Used by:
 *
 *   - the project detail page (period-bar masthead)
 *   - the projects list (per-row burn % column)
 *   - the timer-start modal (inline "27h/30h this month")
 *   - tests in this directory
 *
 * Period boundaries are calendar-based in the user's TZ:
 *   - weekly:    Monday 00:00 → next Monday 00:00 (local), UTC-converted
 *   - monthly:   first day of month → first day of next month
 *   - quarterly: calendar quarter (Jan-Mar / Apr-Jun / Jul-Sep / Oct-Dec)
 *
 * Carryover values other than `'none'` are accepted by the type but
 * not implemented in v1 — `none` is the only behavior the math
 * below honors. The other enum values exist so a future "rolls
 * within the quarter" or "lifetime pool" extension lands without a
 * destructive migration. Pass `'none'` from callers; the helper
 * silently treats other values as `'none'` until expanded.
 */

import {
  addLocalDays,
  getLocalWeekStart,
  localDateMidnightUtc,
  utcToLocalDateStr,
} from "@/lib/time/tz";

export type BudgetPeriod = "weekly" | "monthly" | "quarterly";
export type BudgetCarryover = "none" | "within_quarter" | "lifetime";

export interface PeriodBounds {
  /** Local-tz date string (YYYY-MM-DD) at the start of the period. */
  startLocal: string;
  /** Local-tz date string (YYYY-MM-DD) at the start of the NEXT
   *  period — i.e. the exclusive upper bound. */
  endLocal: string;
  /** UTC instant corresponding to startLocal in the user's TZ. */
  startUtc: Date;
  /** UTC instant corresponding to endLocal in the user's TZ —
   *  exclusive upper bound. */
  endUtc: Date;
}

/**
 * Bounds of the period containing `anchorLocalDate` (a YYYY-MM-DD
 * string in the user's TZ — typically today).
 */
export function computeCurrentPeriodBounds(
  period: BudgetPeriod,
  anchorLocalDate: string,
  tzOffsetMin: number,
): PeriodBounds {
  if (period === "weekly") {
    const weekStart = getLocalWeekStart(anchorLocalDate);
    const weekEnd = addLocalDays(weekStart, 7);
    return {
      startLocal: weekStart,
      endLocal: weekEnd,
      startUtc: localDateMidnightUtc(weekStart, tzOffsetMin),
      endUtc: localDateMidnightUtc(weekEnd, tzOffsetMin),
    };
  }
  if (period === "monthly") {
    const [yStr, mStr] = anchorLocalDate.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      throw new Error(`Invalid anchor date: ${anchorLocalDate}`);
    }
    const start = `${pad4(year)}-${pad2(month)}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${pad4(nextYear)}-${pad2(nextMonth)}-01`;
    return {
      startLocal: start,
      endLocal: end,
      startUtc: localDateMidnightUtc(start, tzOffsetMin),
      endUtc: localDateMidnightUtc(end, tzOffsetMin),
    };
  }
  // quarterly — calendar quarters (Q1 = Jan-Mar etc.)
  const [yStr, mStr] = anchorLocalDate.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error(`Invalid anchor date: ${anchorLocalDate}`);
  }
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const start = `${pad4(year)}-${pad2(quarterStartMonth)}-01`;
  const nextQuarterStartMonth = quarterStartMonth + 3;
  const nextStartMonth =
    nextQuarterStartMonth > 12 ? nextQuarterStartMonth - 12 : nextQuarterStartMonth;
  const nextStartYear =
    nextQuarterStartMonth > 12 ? year + 1 : year;
  const end = `${pad4(nextStartYear)}-${pad2(nextStartMonth)}-01`;
  return {
    startLocal: start,
    endLocal: end,
    startUtc: localDateMidnightUtc(start, tzOffsetMin),
    endUtc: localDateMidnightUtc(end, tzOffsetMin),
  };
}

/**
 * Bounds of the period IMMEDIATELY BEFORE the one containing
 * `anchorLocalDate`. Used by the "Last period: 28h/30h" caption on
 * the project detail page so a user landing the day after rollover
 * doesn't see "0/30" with no context.
 */
export function computePreviousPeriodBounds(
  period: BudgetPeriod,
  anchorLocalDate: string,
  tzOffsetMin: number,
): PeriodBounds {
  const current = computeCurrentPeriodBounds(period, anchorLocalDate, tzOffsetMin);
  // Anchor one day before the current period's start to land in the
  // previous period, then re-resolve bounds.
  const prevAnchor = addLocalDays(current.startLocal, -1);
  return computeCurrentPeriodBounds(period, prevAnchor, tzOffsetMin);
}

/**
 * Sum `duration_min` across entries whose `start_time` falls within
 * `[startUtc, endUtc)`. Pure — caller passes the entries it has;
 * we don't filter by project id (caller should pre-filter).
 */
export function sumMinutesInPeriod(
  entries: ReadonlyArray<{
    start_time: string;
    duration_min: number | null;
  }>,
  startUtc: Date,
  endUtc: Date,
): number {
  let total = 0;
  const startMs = startUtc.getTime();
  const endMs = endUtc.getTime();
  for (const e of entries) {
    const t = new Date(e.start_time).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= startMs && t < endMs) {
      total += e.duration_min ?? 0;
    }
  }
  return total;
}

export interface PeriodBurn {
  /** Minutes logged in the current period. */
  minutes: number;
  /** Hours logged (minutes / 60). */
  hours: number;
  /** Hours cap from the project (or null when no hours cap). */
  capHours: number | null;
  /** Dollars cap from the project (or null when no dollar cap). */
  capDollars: number | null;
  /** Burn % against capHours, capped at 999 (so over-budget shows
   *  legibly without overflowing the bar; the bar fill itself caps
   *  at 100). null when no hours cap. */
  pctHours: number | null;
  /** True when at least one cap exists AND the burn meets or
   *  exceeds the project's threshold. False (and the banner stays
   *  hidden) when the project has no threshold or no cap. */
  alertActive: boolean;
  /** Resolved bounds for the current period. */
  bounds: PeriodBounds;
}

/**
 * Resolve the current period's burn for a project. `entries` should
 * already be filtered to the project (this helper sums whatever it
 * gets). When the project has no recurring period configured,
 * returns null so callers can render an empty/hidden state.
 */
export function computeProjectPeriodBurn(args: {
  budget_period: BudgetPeriod | null;
  budget_hours_per_period: number | null;
  budget_dollars_per_period: number | null;
  budget_alert_threshold_pct: number | null;
  /** Effective hourly rate for the project — used to convert hours
   *  into dollars when computing dollar burn. Null = no rate, dollar
   *  burn is null too. */
  effectiveRate: number | null;
  entries: ReadonlyArray<{
    start_time: string;
    duration_min: number | null;
  }>;
  /** Local YYYY-MM-DD date in the user's TZ (typically today). */
  anchorLocalDate: string;
  tzOffsetMin: number;
}): PeriodBurn | null {
  if (!args.budget_period) return null;
  const bounds = computeCurrentPeriodBounds(
    args.budget_period,
    args.anchorLocalDate,
    args.tzOffsetMin,
  );
  const minutes = sumMinutesInPeriod(args.entries, bounds.startUtc, bounds.endUtc);
  const hours = minutes / 60;
  const capHours = args.budget_hours_per_period ?? null;
  const capDollars = args.budget_dollars_per_period ?? null;
  const pctHours =
    capHours && capHours > 0
      ? Math.min(999, (hours / capHours) * 100)
      : null;
  let alertActive = false;
  if (args.budget_alert_threshold_pct != null) {
    if (pctHours != null && pctHours >= args.budget_alert_threshold_pct) {
      alertActive = true;
    }
    if (
      capDollars &&
      capDollars > 0 &&
      args.effectiveRate &&
      args.effectiveRate > 0
    ) {
      const dollars = hours * args.effectiveRate;
      const pctDollars = (dollars / capDollars) * 100;
      if (pctDollars >= args.budget_alert_threshold_pct) {
        alertActive = true;
      }
    }
  }
  return {
    minutes,
    hours,
    capHours,
    capDollars,
    pctHours,
    alertActive,
    bounds,
  };
}

/**
 * Convert a UTC-instant timestamp back to a local YYYY-MM-DD using
 * the same TZ offset model as `localDateMidnightUtc`. Re-exported
 * here so callers don't have to import from two places when doing
 * period math.
 */
export function localDateAt(
  instant: Date,
  tzOffsetMin: number,
): string {
  return utcToLocalDateStr(instant, tzOffsetMin);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}
