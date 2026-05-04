/**
 * Pure parser for the jump-to-date free-text input.
 *
 * Accepts five shapes; returns a resolved local date string or a
 * structured failure for the caller to render. No date math against
 * `now()` or any wall clock — all "relative" parses (today,
 * yesterday) take the user's *today* as a parameter so the parser
 * is deterministic across timezones and testable without
 * mocking Date.
 *
 * Shapes:
 *   "2026-03-15"  → exact day
 *   "2026-03"     → first day of that month
 *   "2026-Q1"     → first day of that quarter
 *   "today"       → todayLocal verbatim
 *   "yesterday"   → todayLocal − 1 day
 *
 * Returned date is always a YYYY-MM-DD local-date string; the
 * caller maps it through the view-aware drop-target snap (Week →
 * Monday, Day → exact, Log → re-anchor) before pushing to the URL.
 *
 * Out-of-range protection: a parsed date that's wildly wrong
 * (year < 2000 or year > 2099) is rejected — those are typo
 * attractors ("226-03-15" → 226 AD) that produce empty pages
 * silently. The caller surfaces the error inline.
 */

import { addLocalDays } from "./tz";

export interface JumpParseSuccess {
  ok: true;
  /** YYYY-MM-DD local-date string. */
  date: string;
  /** Human label of what the parser resolved to. Used by the live
   *  region announcement and the inline preview. */
  resolvedLabel: string;
}

export interface JumpParseFailure {
  ok: false;
  /** Human-readable error for inline display. Already i18n-style
   *  English; the caller wraps in a translated alert if needed. */
  error: string;
}

export type JumpParseResult = JumpParseSuccess | JumpParseFailure;

const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseJumpInput(
  raw: string,
  todayLocal: string,
): JumpParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a date." };
  }
  const lower = trimmed.toLowerCase();

  if (lower === "today") {
    return {
      ok: true,
      date: todayLocal,
      resolvedLabel: `Today (${formatLong(todayLocal)})`,
    };
  }
  if (lower === "yesterday") {
    const date = addLocalDays(todayLocal, -1);
    return {
      ok: true,
      date,
      resolvedLabel: `Yesterday (${formatLong(date)})`,
    };
  }

  // YYYY-MM-DD — exact day.
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dayMatch) {
    const y = Number(dayMatch[1]);
    const m = Number(dayMatch[2]);
    const d = Number(dayMatch[3]);
    if (!isInYearRange(y)) {
      return { ok: false, error: `Year ${y} is out of range.` };
    }
    if (m < 1 || m > 12) {
      return { ok: false, error: `Month ${m} is invalid.` };
    }
    const dim = daysInMonth(y, m);
    if (d < 1 || d > dim) {
      return {
        ok: false,
        error: `${MONTH_NAMES[m - 1]} ${y} only has ${dim} days.`,
      };
    }
    return { ok: true, date: trimmed, resolvedLabel: formatLong(trimmed) };
  }

  // YYYY-Qn — first day of quarter.
  const qMatch = /^(\d{4})-q([1-4])$/i.exec(trimmed);
  if (qMatch) {
    const y = Number(qMatch[1]);
    const q = Number(qMatch[2]);
    if (!isInYearRange(y)) {
      return { ok: false, error: `Year ${y} is out of range.` };
    }
    const firstMonth = (q - 1) * 3 + 1;
    const date = `${y}-${String(firstMonth).padStart(2, "0")}-01`;
    const lastMonth = firstMonth + 2;
    const lastDay = daysInMonth(y, lastMonth);
    return {
      ok: true,
      date,
      resolvedLabel:
        `${y} Q${q} (${MONTH_NAMES[firstMonth - 1]} 1 – ` +
        `${MONTH_NAMES[lastMonth - 1]} ${lastDay})`,
    };
  }

  // YYYY-MM — first day of month.
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthMatch) {
    const y = Number(monthMatch[1]);
    const m = Number(monthMatch[2]);
    if (!isInYearRange(y)) {
      return { ok: false, error: `Year ${y} is out of range.` };
    }
    if (m < 1 || m > 12) {
      return { ok: false, error: `Month ${m} is invalid.` };
    }
    const date = `${y}-${String(m).padStart(2, "0")}-01`;
    return {
      ok: true,
      date,
      resolvedLabel: `${MONTH_NAMES[m - 1]} ${y}`,
    };
  }

  return {
    ok: false,
    error: `"${trimmed}" isn't a date. Try 2026-03-15, 2026-03, 2026-Q1, today, or yesterday.`,
  };
}

function isInYearRange(y: number): boolean {
  return Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatLong(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Pre-canned chip dates. Caller passes `todayLocal` and `tzOffsetMin`;
 *  return value is the date string to push as `?anchor=`. */
export interface ChipResolver {
  todayLocal: string;
  /** ISO week-start helper — use the existing `getLocalWeekStart`
   *  to keep "Last week" honest about Monday. Pass the bare
   *  function to avoid a circular dep. */
  getLocalWeekStart: (dateStr: string) => string;
}

export function resolveChip(
  chip: "today" | "yesterday" | "lastWeek" | "lastMonth" | "lastQuarter",
  ctx: ChipResolver,
): { date: string; label: string } {
  const { todayLocal, getLocalWeekStart } = ctx;
  switch (chip) {
    case "today":
      return { date: todayLocal, label: "Today" };
    case "yesterday": {
      const date = addLocalDays(todayLocal, -1);
      return { date, label: "Yesterday" };
    }
    case "lastWeek": {
      // Monday of last week.
      const thisMonday = getLocalWeekStart(todayLocal);
      const date = addLocalDays(thisMonday, -7);
      return { date, label: "Last week" };
    }
    case "lastMonth": {
      const [y, m] = todayLocal.split("-").map(Number);
      const lastMonth = m === 1 ? 12 : m! - 1;
      const lastMonthYear = m === 1 ? y! - 1 : y!;
      const date = `${lastMonthYear}-${String(lastMonth).padStart(2, "0")}-01`;
      return { date, label: "Last month" };
    }
    case "lastQuarter": {
      const [y, m] = todayLocal.split("-").map(Number);
      const thisQuarter = Math.ceil(m! / 3);
      const lastQuarter = thisQuarter === 1 ? 4 : thisQuarter - 1;
      const lastQuarterYear = thisQuarter === 1 ? y! - 1 : y!;
      const firstMonth = (lastQuarter - 1) * 3 + 1;
      const date = `${lastQuarterYear}-${String(firstMonth).padStart(2, "0")}-01`;
      return { date, label: "Last quarter" };
    }
  }
}
