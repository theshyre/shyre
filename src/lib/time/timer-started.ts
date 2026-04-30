/**
 * Format the "Started …" caption shown on the running-timer card +
 * header pill.
 *
 * The number alone (HH:MM:SS elapsed) is fine for a fresh timer but
 * useless for a forgotten one — a Harvest entry imported with
 * is_running=true used to surface as "RUNNING 2747:57:01" with no
 * indication of what date that timer is for. Without the date the
 * user can't even find the underlying entry to delete it.
 *
 * Output shape:
 *   - Same day:        "Started 9:15 AM"
 *   - Yesterday:       "Started yesterday at 3:42 PM"
 *   - Within a week:   "Started Mon at 9:30 AM (3d ago)"
 *   - Older:           "Started Apr 15 at 9:30 AM (47d ago)"
 *   - Cross-year:      "Started Apr 15, 2025 (114d ago)"
 *
 * Locale-honest via Intl.DateTimeFormat (no hardcoded en-US strings
 * in the template — month/day order honors the user's locale).
 */

export function formatTimerStarted(
  startTimeIso: string,
  nowMs: number = Date.now(),
  locale?: string,
): string {
  const start = new Date(startTimeIso);
  if (isNaN(start.getTime())) return "Started —";

  const startDay = startOfLocalDay(start);
  const today = startOfLocalDay(new Date(nowMs));
  const dayDiff = Math.round(
    (today.getTime() - startDay.getTime()) / 86_400_000,
  );
  const sameYear = start.getFullYear() === new Date(nowMs).getFullYear();

  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(start);

  if (dayDiff === 0) {
    return `Started ${time}`;
  }
  if (dayDiff === 1) {
    return `Started yesterday at ${time}`;
  }
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = new Intl.DateTimeFormat(locale, {
      weekday: "short",
    }).format(start);
    return `Started ${weekday} at ${time} (${dayDiff}d ago)`;
  }
  // ≥7 days ago — show full date, year only when different
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(start);
  return `Started ${date} at ${time} (${dayDiff}d ago)`;
}

/** Local-day start in the runtime's timezone — same trick the running-
 *  timer baseline uses. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Build a deep link to the day view that contains a time entry. The
 * `anchor` URL param scrolls /time-entries to the right day; an
 * `entry-{id}` hash takes the user to the specific row when entry-row
 * cards opt into the id (see entry-row.tsx).
 */
export function entryDeepLink(startTimeIso: string, entryId: string): string {
  const d = new Date(startTimeIso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `/time-entries?view=day&anchor=${yyyy}-${mm}-${dd}#entry-${entryId}`;
}
