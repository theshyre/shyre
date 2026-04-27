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
 *  entry for the *same row*. Pass `newer = null` for the most recent
 *  entry — we then enumerate the previous-state values for the
 *  labeled fields, omitting the HIDDEN_KEYS noise.
 *
 *  Diff semantics: for each known label, if the values differ by
 *  JSON serialization, surface the change. Skip equal pairs. Order
 *  is preserved from the labels map.
 *
 *  Default labels + hidden keys are the `business_people` set.
 *  Other tables (businesses, business_state_registrations) pass
 *  their own maps so a single util serves every history surface.
 */
export function computeFieldDiff(
  previousState: Record<string, unknown>,
  newerPreviousState: Record<string, unknown> | null,
  options?: {
    labels?: Record<string, string>;
    hiddenKeys?: Set<string>;
  },
): FieldChange[] {
  const labels = options?.labels ?? FIELD_LABELS;
  const hiddenKeys = options?.hiddenKeys ?? HIDDEN_KEYS;

  if (newerPreviousState === null) {
    const out: FieldChange[] = [];
    for (const [key, value] of Object.entries(previousState)) {
      if (hiddenKeys.has(key)) continue;
      const label = labels[key];
      if (!label) continue;
      out.push({ key, label, from: value, to: undefined });
    }
    return out;
  }

  const out: FieldChange[] = [];
  for (const key of Object.keys(labels)) {
    const before = previousState[key];
    const after = newerPreviousState[key];
    if (!isEqual(before, after)) {
      out.push({ key, label: labels[key]!, from: before, to: after });
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

/** Walk a newest-first list of history entries and attach a per-entry
 *  field diff. Each entry's diff is computed against the next-newer
 *  entry *in the same group* (e.g. same person, same registration);
 *  the most-recent entry per group has no newer neighbor and gets
 *  the "previous values" enumeration instead.
 *
 *  Used by both timeline components and both CSV routes — shared so
 *  the diff semantics stay consistent across surfaces.
 *
 *  Generic over `E` so callers pass their own row shape (plus
 *  accessor + per-entry labels).
 */
export function expandWithFieldDiffs<E>(args: {
  /** Entries in newest-first order. */
  entries: E[];
  /** Stable identifier that partitions entries into "same row over
   *  time" buckets — diffs only happen within a group. */
  groupKey: (entry: E) => string;
  /** The captured snapshot for an entry (typically the
   *  `previous_state` JSONB column). */
  previousState: (entry: E) => Record<string, unknown>;
  /** Field-label map. May vary per-entry when the timeline merges
   *  rows from different tables (e.g. business + registration). */
  labels: (entry: E) => Record<string, string>;
  /** Keys to hide on the most-recent-entry enumeration. Constant
   *  across the page; passed in so callers can use their own set. */
  hiddenKeys: Set<string>;
}): Array<{ entry: E; fields: FieldChange[] }> {
  // Walk newest→oldest. The first time we see a group, the entry is
  // the newest in that group → no next-newer neighbor → emit the
  // most-recent enumeration. On subsequent iterations, the previously
  // stored value IS the next-newer neighbor (we just saw it, and
  // we're walking backwards in time), so diff against it.
  //
  // Earlier versions of this loop walked oldest→newest, which fed
  // the *older* neighbor as `newer` — surfacing the wrong author's
  // changes. Direction matters; resist the temptation to "simplify"
  // it back.
  const newerByGroup = new Map<string, E>();
  return args.entries.map((entry) => {
    const key = args.groupKey(entry);
    const newer = newerByGroup.get(key) ?? null;
    const fields = computeFieldDiff(
      args.previousState(entry),
      newer === null ? null : args.previousState(newer),
      { labels: args.labels(entry), hiddenKeys: args.hiddenKeys },
    );
    newerByGroup.set(key, entry);
    return { entry, fields };
  });
}
