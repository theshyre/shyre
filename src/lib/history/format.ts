/**
 * Pure formatting + diff helpers for "audit history" timelines across
 * Shyre — business people, business identity, projects, and any
 * future `*_history` table. Generic over the row shape: field-label
 * maps and hidden-key sets are domain data owned by each module and
 * always passed in by the caller (see `docs/reference/modules.md`'s
 * expenses-primitives playbook for why domain data stays module-side
 * while the mechanics move here). Extracted so the diff/format logic
 * can be unit-tested without rendering any component, and so every
 * history surface shares identical diff semantics.
 */

export interface FieldChange {
  key: string;
  label: string;
  from: unknown;
  /** Undefined when this is the most-recent entry for a row — there's
   *  no next-newer snapshot to compute a "to" against, so the UI
   *  renders the previous value alone. Defined when a diff was
   *  actually computed against a newer entry. */
  to: unknown | undefined;
}

/** Compute the field-level diff between an entry and the next-newer
 *  entry for the *same row*. Pass `newerPreviousState = null` for the
 *  most recent entry — we then enumerate the previous-state values
 *  for the labeled fields, omitting the caller's hidden keys.
 *
 *  Diff semantics: for each known label, if the values differ by
 *  JSON serialization, surface the change. Skip equal pairs. Order
 *  is preserved from the labels map.
 *
 *  `labels` and `hiddenKeys` are required — this module has no
 *  domain knowledge of any one table's columns, so every caller
 *  supplies its own (e.g. `business_people`, `businesses`,
 *  `projects`).
 */
export function computeFieldDiff(
  previousState: Record<string, unknown>,
  newerPreviousState: Record<string, unknown> | null,
  options: {
    labels: Record<string, string>;
    hiddenKeys: Set<string>;
  },
): FieldChange[] {
  const { labels, hiddenKeys } = options;

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
 *  entry *in the same group* (e.g. same person, same registration,
 *  same project); the most-recent entry per group has no newer
 *  neighbor and gets the "previous values" enumeration instead.
 *
 *  Used by every history timeline component and every history CSV
 *  route — shared so the diff semantics stay consistent across
 *  surfaces.
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
