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
