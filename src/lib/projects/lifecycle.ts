/**
 * Project lifecycle helpers — derived signals that aren't stored on the
 * row. Kept pure (today is injectable) so the overdue rule is unit-
 * testable without faking the clock.
 */

/**
 * Server-local today as an ISO `YYYY-MM-DD` string. Mirrors the
 * read-time-overdue convention the invoices list uses for `due_date`
 * (we don't persist "overdue" — it's computed against today at read).
 */
export function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * A project is "overdue" when it is still live (active or paused) and
 * its projected end date is in the past. Closed-out (`completed`) and
 * `archived` projects are never overdue — they're done, not late.
 *
 * Both operands share the `YYYY-MM-DD` DATE shape (no timezone suffix),
 * so a lexical `<` comparison is chronological — safe here, unlike the
 * timestamptz-vs-`Z` string trap that bites elsewhere.
 */
export function isProjectOverdue(
  projectedEndDate: string | null | undefined,
  status: string | null | undefined,
  today: string = todayLocalDate(),
): boolean {
  if (!projectedEndDate) return false;
  if (status !== "active" && status !== "paused") return false;
  return projectedEndDate < today;
}
