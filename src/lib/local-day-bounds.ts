/**
 * Returns `[dayStartIso, dayEndIso]` in the viewer's local timezone,
 * expressed as UTC ISO strings. Used to tell the server which entries
 * count as "today" when deciding whether to resume vs. insert a new
 * timer row.
 */
export function localDayBoundsIso(now: Date = new Date()): [string, string] {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return [dayStart.toISOString(), dayEnd.toISOString()];
}

/**
 * Returns true when `tsIso` falls in `[dayStartIso, dayEndIso)`.
 *
 * Why this exists: Postgres `timestamptz` is serialized by PostgREST
 * as `"YYYY-MM-DDTHH:MM:SS+00:00"`, while `Date.prototype.toISOString`
 * produces `"YYYY-MM-DDTHH:MM:SS.sssZ"`. A raw string compare puts
 * `"...+00:00"` lexicographically *before* `"...Z"` even when the
 * instants are identical, so an entry whose start is exactly at the
 * day boundary gets misclassified as "previous day". Always compare
 * as numeric ms.
 */
export function isInLocalDay(
  tsIso: string,
  dayStartIso: string,
  dayEndIso: string,
): boolean {
  const ts = new Date(tsIso).getTime();
  const start = new Date(dayStartIso).getTime();
  const end = new Date(dayEndIso).getTime();
  return ts >= start && ts < end;
}
