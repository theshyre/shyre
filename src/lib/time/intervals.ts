/**
 * Interval helpers for time tracking.
 * An "interval" is a date range filter: day, week, month, or custom.
 */

import { getWeekStart } from "./week";

export type IntervalKind = "day" | "week" | "month" | "custom";
export const ALL_INTERVALS: IntervalKind[] = ["day", "week", "month", "custom"];

export interface IntervalParams {
  kind: IntervalKind;
  /** Anchor date for kind=day|week|month; ignored for custom */
  anchor?: Date;
  /** Explicit range for custom (inclusive start, exclusive end) */
  from?: Date;
  to?: Date;
}

export interface ResolvedInterval {
  kind: IntervalKind;
  start: Date;
  /** exclusive end */
  end: Date;
}

function parseDateOnly(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  if (isNaN(date.getTime())) return null;
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  )
    return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Get today's date at local midnight.
 */
export function getTodayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Day range for the given date (or today).
 */
export function getDayRange(date: Date = getTodayStart()): {
  start: Date;
  end: Date;
} {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Month range containing the given date (1st of month .. 1st of next month).
 */
export function getMonthRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

/**
 * Parse URL params into a resolved interval. Defaults to this week.
 *
 * Params honored:
 *   interval: "day" | "week" | "month" | "custom"
 *   anchor:   YYYY-MM-DD for day/week/month (defaults today)
 *   from,to:  YYYY-MM-DD for custom (to is inclusive; we add a day internally)
 *
 * Invalid/missing params fall back to week-of-today.
 */
export function parseIntervalParams(params: {
  interval?: string;
  anchor?: string;
  from?: string;
  to?: string;
}): ResolvedInterval {
  const kind = asKind(params.interval);
  const today = getTodayStart();

  if (kind === "custom") {
    const from = parseDateOnly(params.from);
    const to = parseDateOnly(params.to);
    if (from && to && to >= from) {
      // to is inclusive — add a day to make it exclusive end
      const end = new Date(to);
      end.setDate(end.getDate() + 1);
      return { kind: "custom", start: from, end };
    }
    // Invalid custom range → fall back to this week
    const weekStart = getWeekStart(today);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return { kind: "week", start: weekStart, end: weekEnd };
  }

  const anchor = parseDateOnly(params.anchor) ?? today;

  if (kind === "day") return { kind, ...getDayRange(anchor) };
  if (kind === "month") return { kind, ...getMonthRange(anchor) };

  // week (default)
  const weekStart = getWeekStart(anchor);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return { kind: "week", start: weekStart, end: weekEnd };
}

function asKind(v: string | undefined): IntervalKind {
  if (v === "day" || v === "week" || v === "month" || v === "custom") return v;
  return "week";
}

/**
 * Build URL search params for a given interval, preserving the existing params.
 */
export function intervalToSearchParams(
  existing: URLSearchParams,
  resolved: ResolvedInterval,
): URLSearchParams {
  const next = new URLSearchParams(existing.toString());
  next.set("interval", resolved.kind);
  // Remove stale params
  next.delete("anchor");
  next.delete("from");
  next.delete("to");
  if (resolved.kind === "custom") {
    const to = new Date(resolved.end);
    to.setDate(to.getDate() - 1);
    next.set("from", fmt(resolved.start));
    next.set("to", fmt(to));
  } else {
    next.set("anchor", fmt(resolved.start));
  }
  return next;
}

/**
 * Shift an interval by +/- 1 unit (previous day, next week, etc.).
 * Custom intervals shift by the exact length of the current range.
 */
export function shiftInterval(
  resolved: ResolvedInterval,
  direction: 1 | -1,
): ResolvedInterval {
  if (resolved.kind === "day") {
    const anchor = new Date(resolved.start);
    anchor.setDate(anchor.getDate() + direction);
    return { kind: "day", ...getDayRange(anchor) };
  }
  if (resolved.kind === "week") {
    const anchor = new Date(resolved.start);
    anchor.setDate(anchor.getDate() + direction * 7);
    const weekStart = getWeekStart(anchor);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return { kind: "week", start: weekStart, end: weekEnd };
  }
  if (resolved.kind === "month") {
    const anchor = new Date(
      resolved.start.getFullYear(),
      resolved.start.getMonth() + direction,
      1,
    );
    return { kind: "month", ...getMonthRange(anchor) };
  }
  // custom — shift by the exact length
  const lenMs = resolved.end.getTime() - resolved.start.getTime();
  const start = new Date(resolved.start.getTime() + direction * lenMs);
  const end = new Date(resolved.end.getTime() + direction * lenMs);
  return { kind: "custom", start, end };
}

/**
 * Return an interval anchored at today.
 */
export function intervalFromToday(kind: IntervalKind): ResolvedInterval {
  const today = getTodayStart();
  if (kind === "day") return { kind, ...getDayRange(today) };
  if (kind === "month") return { kind, ...getMonthRange(today) };
  if (kind === "custom") {
    // Default custom = last 7 days including today
    const end = new Date(today);
    end.setDate(end.getDate() + 1);
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { kind: "custom", start, end };
  }
  // week
  const weekStart = getWeekStart(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return { kind: "week", start: weekStart, end: weekEnd };
}

/**
 * Human-friendly label for an interval. e.g. "Today", "Apr 13–19", "April 2026",
 * "Apr 1–Apr 7, 2026".
 */
export function formatIntervalLabel(
  resolved: ResolvedInterval,
  locale = "en",
): string {
  const { start, end, kind } = resolved;
  const today = getTodayStart();
  const endInclusive = new Date(end);
  endInclusive.setDate(endInclusive.getDate() - 1);

  if (kind === "day") {
    if (start.getTime() === today.getTime()) return "Today";
    return start.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year:
        start.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
  }

  if (kind === "month") {
    return start.toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
    });
  }

  // week or custom — show range
  const sameYear = start.getFullYear() === endInclusive.getFullYear();
  const sameMonth = sameYear && start.getMonth() === endInclusive.getMonth();

  const startLabel = start.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year:
      !sameYear || start.getFullYear() !== today.getFullYear()
        ? "numeric"
        : undefined,
  });
  const endLabel = endInclusive.toLocaleDateString(locale, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year:
      endInclusive.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
  return `${startLabel}–${endLabel}`;
}
