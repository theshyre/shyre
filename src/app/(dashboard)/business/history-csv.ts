import { formatValue, type FieldChange } from "./[businessId]/people/history/history-format";

/**
 * Pure helpers for turning audit-history entries into CSV rows.
 * Both `/api/business/[businessId]/people-history/csv` and
 * `/api/business/[businessId]/identity-history/csv` call into these
 * so the row format (one row per changed field, with a placeholder
 * row for empty diffs) stays identical across surfaces.
 */

export interface HistoryCsvFieldRow {
  field: string;
  previous_value: string;
  new_value: string;
}

/** Expand a list of `{entry, fields}` (the output of
 *  `expandWithFieldDiffs`) into CSV rows.
 *
 *  - When an entry's diff has fields, emit one CSV row per field.
 *  - When the diff is empty (an UPDATE recorded but no labeled
 *    fields differ), emit a single placeholder row so the export
 *    still reflects every audit entry.
 *
 *  Caller supplies `buildBase(entry)` returning the
 *  per-entry-constant columns (timestamp, actor, row label, etc.).
 *  The field/previous_value/new_value columns are stamped on top.
 */
export function expandToCsvRows<E, B extends Record<string, string>>(
  expanded: Array<{ entry: E; fields: FieldChange[] }>,
  buildBase: (entry: E) => B,
): Array<B & HistoryCsvFieldRow> {
  const out: Array<B & HistoryCsvFieldRow> = [];
  for (const { entry, fields } of expanded) {
    const base = buildBase(entry);
    if (fields.length === 0) {
      out.push({
        ...base,
        field: "",
        previous_value: "",
        new_value: "",
      });
      continue;
    }
    for (const field of fields) {
      out.push({
        ...base,
        field: field.label,
        previous_value: formatValue(field.from),
        new_value: field.to === undefined ? "" : formatValue(field.to),
      });
    }
  }
  return out;
}
