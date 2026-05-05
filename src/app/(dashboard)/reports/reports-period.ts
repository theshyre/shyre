/**
 * Resolve the date range for the reports page.
 *
 * The page used to aggregate every time entry the viewer could see —
 * lifetime numbers that became useless after the first quarter. Now
 * the page reads `from` / `to` (YYYY-MM-DD, inclusive, UTC) from the
 * URL and falls back to "this month so far" — the most-common use
 * case for monthly invoicing.
 *
 * Pure helpers so the server page and tests can pin "today" instead
 * of pulling `new Date()` in two places.
 */

export interface ReportsPeriod {
  from: string;
  to: string;
  preset: ReportsPreset;
}

export type ReportsPreset =
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "custom";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmt(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function todayUtc(today?: Date): Date {
  return today ?? new Date();
}

export function thisMonth(today?: Date): { from: string; to: string } {
  const now = todayUtc(today);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return {
    from: fmt(y, m, 1),
    to: fmt(y, m, now.getUTCDate()),
  };
}

export function lastMonth(today?: Date): { from: string; to: string } {
  const now = todayUtc(today);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  // last month = m-1 in 1-indexed terms; if m=0 (Jan) -> previous Dec.
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0)); // day 0 of current month = last day of prev month
  return {
    from: fmt(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1),
    to: fmt(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate()),
  };
}

export function thisQuarter(today?: Date): { from: string; to: string } {
  const now = todayUtc(today);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const startMonth = Math.floor(m / 3) * 3; // 0, 3, 6, 9
  return {
    from: fmt(y, startMonth + 1, 1),
    to: fmt(y, now.getUTCMonth() + 1, now.getUTCDate()),
  };
}

export function lastQuarter(today?: Date): { from: string; to: string } {
  const now = todayUtc(today);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startMonth = Math.floor(m / 3) * 3 - 3; // can be negative
  const start = new Date(Date.UTC(y, startMonth, 1));
  const end = new Date(Date.UTC(y, startMonth + 3, 0)); // last day of last month of prev quarter
  return {
    from: fmt(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    to: fmt(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()),
  };
}

export function thisYear(today?: Date): { from: string; to: string } {
  const now = todayUtc(today);
  const y = now.getUTCFullYear();
  return {
    from: fmt(y, 1, 1),
    to: fmt(y, now.getUTCMonth() + 1, now.getUTCDate()),
  };
}

/** Resolve a (from?, to?, preset?) URL search-param triple into the
 *  effective date range. Validates ISO date shape; falls back to
 *  this-month-to-date on any invalid combination. */
export function resolveReportsPeriod(
  params: { from?: string | null; to?: string | null; preset?: string | null },
  today?: Date,
): ReportsPeriod {
  const presetKey = (params.preset ?? "").trim() as ReportsPreset;

  if (presetKey === "last_month") {
    return { ...lastMonth(today), preset: "last_month" };
  }
  if (presetKey === "this_quarter") {
    return { ...thisQuarter(today), preset: "this_quarter" };
  }
  if (presetKey === "last_quarter") {
    return { ...lastQuarter(today), preset: "last_quarter" };
  }
  if (presetKey === "this_year") {
    return { ...thisYear(today), preset: "this_year" };
  }

  // If both from and to are valid ISO dates and from <= to, use them.
  const from = (params.from ?? "").trim();
  const to = (params.to ?? "").trim();
  if (
    ISO_DATE.test(from) &&
    ISO_DATE.test(to) &&
    from <= to
  ) {
    return { from, to, preset: "custom" };
  }

  return { ...thisMonth(today), preset: "this_month" };
}

/** Inclusive `to` date as the upper bound of an end-of-day filter.
 *  Reports' source query filters by `start_time`, which is a TIMESTAMPTZ;
 *  to capture the full last day, we extend to 23:59:59.999Z. */
export function toIsoEndOfDay(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/** Inclusive `from` date as the lower bound. */
export function fromIsoStartOfDay(date: string): string {
  return `${date}T00:00:00.000Z`;
}
