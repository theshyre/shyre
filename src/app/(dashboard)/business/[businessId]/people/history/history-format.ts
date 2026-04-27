/**
 * Pure formatting + diff helpers used by both `<PersonHistoryDialog>`
 * (per-person modal) and `<HistoryTimeline>` (business-wide page).
 * Extracted so they can be unit-tested without rendering the full
 * client components, and to dedupe the bookkeeping between the two
 * surfaces.
 */

/** Field-label map for keys we surface in the diff. Anything not in
 *  this map is hidden — `business_people` columns we explicitly
 *  don't want a reader to see in the timeline (internal ids, audit
 *  timestamps) just won't have a label and therefore won't render. */
export const FIELD_LABELS: Record<string, string> = {
  legal_name: "Legal name",
  preferred_name: "Preferred name",
  work_email: "Work email",
  work_phone: "Work phone",
  employment_type: "Employment type",
  title: "Title",
  department: "Department",
  employee_number: "Employee number",
  started_on: "Started",
  ended_on: "Ended",
  compensation_type: "Compensation type",
  compensation_amount_cents: "Compensation amount (cents)",
  compensation_currency: "Compensation currency",
  compensation_schedule: "Compensation schedule",
  address_line1: "Address line 1",
  address_line2: "Address line 2",
  city: "City",
  state: "State",
  postal_code: "Postal code",
  country: "Country",
  reports_to_person_id: "Reports to",
  notes: "Notes",
  user_id: "Linked Shyre user",
  deleted_at: "Deleted at",
};

/** Columns we filter out of the "previous values" listing for the
 *  most-recent (no-newer-neighbor) entry. These don't help a reader
 *  understand the change. */
export const HIDDEN_KEYS = new Set([
  "id",
  "business_id",
  "created_at",
  "updated_at",
  "created_by_user_id",
  "updated_by_user_id",
]);

export interface FieldChange {
  key: string;
  label: string;
  from: unknown;
  /** Undefined when this is the most-recent entry for a person —
   *  there's no next-newer snapshot to compute a "to" against, so the
   *  UI renders the previous value alone. Defined when a diff was
   *  actually computed against a newer entry. */
  to: unknown | undefined;
}

/** Compute the field-level diff between an entry and the next-newer
 *  entry for the *same person*. Pass `newer = null` for the most
 *  recent entry — we then enumerate the previous-state values for
 *  the labeled fields, omitting the HIDDEN_KEYS noise.
 *
 *  Diff semantics: for each known label, if the values differ by
 *  JSON serialization, surface the change. Skip equal pairs. Order
 *  is preserved from `FIELD_LABELS`.
 */
export function computeFieldDiff(
  previousState: Record<string, unknown>,
  newerPreviousState: Record<string, unknown> | null,
): FieldChange[] {
  if (newerPreviousState === null) {
    const out: FieldChange[] = [];
    for (const [key, value] of Object.entries(previousState)) {
      if (HIDDEN_KEYS.has(key)) continue;
      const label = FIELD_LABELS[key];
      if (!label) continue;
      out.push({ key, label, from: value, to: undefined });
    }
    return out;
  }

  const out: FieldChange[] = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const before = previousState[key];
    const after = newerPreviousState[key];
    if (!isEqual(before, after)) {
      out.push({ key, label: FIELD_LABELS[key]!, from: before, to: after });
    }
  }
  return out;
}

/** Render a JSON-serializable value as a string for display. Empty
 *  strings, null, and undefined collapse to a single em-dash so the
 *  reader doesn't see "empty"/"null"/"undefined" all over the diff. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Format an ISO timestamp using the viewer's locale. Falls back to
 *  the raw ISO string if the date is unparseable so a corrupt row
 *  still renders something. */
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

/** Loose equality for diffing: same reference, same null/undefined
 *  pair, primitive equality, or JSON-equal for objects/arrays. */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
