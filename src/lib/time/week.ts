/**
 * Week and duration helpers for time tracking.
 * Week convention: Monday-starting (ISO 8601).
 */

/**
 * Get the Monday of the week containing the given date (at local 00:00:00).
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday offset
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get a 7-day range (Mon-Sun) starting from the given date's week.
 */
export function getWeekRange(date: Date): { start: Date; end: Date } {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

/**
 * Format a date as YYYY-MM-DD for URL params.
 */
export function isoWeekParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parse a YYYY-MM-DD week param into a Date (local midnight).
 * Returns null if invalid.
 */
export function parseWeekParam(param: string | undefined): Date | null {
  if (!param) return null;
  const match = param.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = match[1];
  const m = match[2];
  const d = match[3];
  if (!y || !m || !d) return null;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (isNaN(date.getTime())) return null;
  // Verify no overflow (e.g. Feb 30 → Mar 2)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return getWeekStart(date); // snap to Monday
}

export interface TimeEntryLike {
  id: string;
  start_time: string;
  end_time: string | null;
  duration_min: number | null;
  billable: boolean;
}

/**
 * Group entries by day of the week. Returns 7 arrays indexed 0..6 (Mon..Sun).
 * Entries are bucketed by their start_time's local date.
 */
export function groupEntriesByDay<T extends TimeEntryLike>(
  entries: T[],
  weekStart: Date,
): T[][] {
  const days: T[][] = [[], [], [], [], [], [], []];
  for (const entry of entries) {
    const entryDate = new Date(entry.start_time);
    const dayMs = 1000 * 60 * 60 * 24;
    const diffDays = Math.floor(
      (entryDate.getTime() - weekStart.getTime()) / dayMs,
    );
    if (diffDays >= 0 && diffDays < 7) {
      days[diffDays]!.push(entry);
    }
  }
  // Sort each day chronologically
  for (const day of days) {
    day.sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
  }
  return days;
}

/**
 * Format minutes as "Hh Mm" (e.g. "2h 30m") or "Mm" for short durations.
 */
export function formatDurationShort(min: number | null): string {
  if (min === null || min <= 0) return "—";
  const hours = Math.floor(min / 60);
  const mins = Math.round(min % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Format minutes as "H:MM" (e.g. "3:15", "0:45") — duration-clock style.
 * This is the hero format for time-entry tables: monospaced, right-aligned.
 */
export function formatDurationHM(min: number | null): string {
  if (min === null || min <= 0) return "—";
  const hours = Math.floor(min / 60);
  const mins = Math.round(min % 60);
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

/**
 * Sum total minutes across entries (only completed ones).
 */
export function sumDurationMin(entries: TimeEntryLike[]): number {
  return entries.reduce((sum, e) => sum + (e.duration_min ?? 0), 0);
}

/**
 * Sum billable minutes.
 */
export function sumBillableMin(entries: TimeEntryLike[]): number {
  return entries
    .filter((e) => e.billable)
    .reduce((sum, e) => sum + (e.duration_min ?? 0), 0);
}

/**
 * Get short day label for locale (e.g. "Mon", "Tue").
 */
export function getDayLabel(date: Date, locale = "en"): string {
  return date.toLocaleDateString(locale, { weekday: "short" });
}

/**
 * Check if two dates are the same calendar day.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Get today's date at local midnight.
 */
export function getTodayStart(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}
