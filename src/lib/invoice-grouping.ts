/**
 * Group time-entry candidates into invoice line items.
 *
 * Shared between the live preview (`/invoices/new`) and the server
 * `createInvoiceAction`. Same input → same output, so the dollar total
 * shown in the preview rail matches the posted invoice to the cent
 * (Bookkeeper persona's "preview === posted" rule).
 *
 * Money math invariant: round each entry's amount independently
 * (`round(hours * rate)`), then sum. Doing it the other way (round-
 * then-multiply) drifts on mixed-rate entries.
 *
 * Mixed-rate split: when a group contains entries at different
 * rates (e.g. by_project but two members at $150 and $185), we
 * split into one line per (groupKey, rate) — the unit_price column
 * shouldn't lie. Description disambiguates with the rate when split
 * happens.
 *
 * Description format: `[<invoice_code>] <project_name>: <task>
 * (<MM/DD/YYYY> – <MM/DD/YYYY>)`. The bracketed code is omitted
 * when the project has none. The `: <task>` segment is omitted in
 * `by_project`/`by_person`/`detailed` modes; replaced by user note
 * in detailed mode. Date range is the LINE's source-entry min/max,
 * not the invoice period — bookkeeper-grade audit alignment.
 */

import type { InvoiceGroupingMode } from "@/app/(dashboard)/invoices/allow-lists";
import {
  calculateLineItemAmount,
  minutesToHours,
} from "./invoice-utils";

/**
 * Per-entry input. Fields that aren't relevant for the chosen
 * grouping mode can be null (e.g. taskName when grouping by_person).
 */
export interface EntryCandidate {
  id: string;
  durationMin: number;
  rate: number;
  /** User-typed description on the time entry. Used as the line
   *  description in `detailed` mode; ignored in collapsed modes. */
  description: string | null;
  /** Resolved group labels. The grouping function reads only the
   *  field its mode needs; callers pass all of them so a single
   *  shape works across modes. */
  projectName: string;
  /** Optional invoice prefix code from `projects.invoice_code`.
   *  Renders as `[CODE]` ahead of the project name. Null when the
   *  project has no code set. */
  projectInvoiceCode: string | null;
  taskName: string | null;
  personName: string;
  /** ISO date (YYYY-MM-DD) the entry was logged. Used for
   *  detailed-mode descriptions, line-level period_start /
   *  period_end, and the invoice-level period_start / period_end
   *  computation by the caller. */
  date: string;
}

export interface GroupedLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** time_entries.id values that rolled up into this line. The
   *  caller writes this onto invoice_line_items.time_entry_id when
   *  there's exactly one source, and uses it to mark all entries
   *  invoiced=true regardless of count. */
  sourceEntryIds: string[];
}

/**
 * Bucket-key components. Each grouping mode contributes a different
 * subset (project for by_project, project + task for by_task, etc.),
 * but every mode keys on `projectName + projectInvoiceCode` so that
 * cross-project collisions on a shared task name (e.g. "Security
 * Administration" appearing on two projects) split into separate
 * lines instead of collapsing — bookkeeper-flagged correctness bug.
 */
function keyForEntry(
  entry: EntryCandidate,
  mode: InvoiceGroupingMode,
): { key: string } {
  // Project token shared across modes. Code wins when set;
  // otherwise fall back to name. Both included to keep the key
  // unique even if a user adds a code mid-invoice (rare).
  const projToken = `${entry.projectInvoiceCode ?? ""}|${entry.projectName}`;

  switch (mode) {
    case "by_task":
      return {
        key: `task:${projToken}::${entry.taskName ?? "__no_task__"}`,
      };
    case "by_person":
      return {
        key: `person:${projToken}::${entry.personName}`,
      };
    case "by_project":
      return {
        key: `project:${projToken}`,
      };
    case "detailed":
      // Each entry is its own line — key has the entry id so no
      // collapse happens.
      return {
        key: `entry:${entry.id}`,
      };
  }
}

interface BucketRow {
  /** Sticky entry used to derive the description (project name,
   *  invoice code, task, person, user-typed note). All entries in a
   *  bucket share the same project + task / person, so any one
   *  works; we use the first observed. */
  representative: EntryCandidate;
  rate: number;
  hours: number;
  amount: number;
  ids: string[];
  minDate: string | null;
  maxDate: string | null;
}

/**
 * Collapse a list of entry candidates into invoice line items per
 * the chosen grouping mode. Same logic the server action runs at
 * submit time — preview and posted invoice agree on dollar totals.
 */
export function groupEntriesIntoLineItems(
  entries: EntryCandidate[],
  mode: InvoiceGroupingMode,
): GroupedLineItem[] {
  // Bucket key: groupKey + rate (cents) so mixed-rate entries within
  // a logical group split into separate lines (Bookkeeper's "the
  // unit_price column shouldn't lie" rule). Rate is in dollars; convert
  // to integer cents for the key so 150.00 and 150.001 don't accidentally
  // create two buckets.
  const buckets = new Map<string, BucketRow>();

  for (const entry of entries) {
    const { key } = keyForEntry(entry, mode);
    const rateCents = Math.round(entry.rate * 100);
    const bucketKey = `${key}::${rateCents}`;
    const hours = minutesToHours(entry.durationMin);
    const entryAmount = calculateLineItemAmount(hours, entry.rate);
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        representative: entry,
        rate: entry.rate,
        hours: 0,
        amount: 0,
        ids: [],
        minDate: null,
        maxDate: null,
      };
      buckets.set(bucketKey, bucket);
    }
    bucket.hours += hours;
    bucket.amount += entryAmount;
    bucket.ids.push(entry.id);
    if (entry.date) {
      if (!bucket.minDate || entry.date < bucket.minDate) {
        bucket.minDate = entry.date;
      }
      if (!bucket.maxDate || entry.date > bucket.maxDate) {
        bucket.maxDate = entry.date;
      }
    }
  }

  // Build base labels (without rate suffix) so we can detect splits.
  // The base label is what the user sees most of the time; the
  // rate suffix only appears when two buckets share a base label
  // (different rates collapsed onto same project/task/person).
  const baseByBucket = new Map<BucketRow, string>();
  for (const bucket of buckets.values()) {
    baseByBucket.set(bucket, baseLabel(bucket.representative, mode));
  }
  const baseCounts = new Map<string, number>();
  for (const base of baseByBucket.values()) {
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  const lines: GroupedLineItem[] = [];
  for (const bucket of buckets.values()) {
    const base = baseByBucket.get(bucket) ?? "";
    const isSplit = (baseCounts.get(base) ?? 0) > 1;
    const dateSuffix = formatDateRange(bucket.minDate, bucket.maxDate);
    const description = composeDescription({
      base,
      rate: isSplit ? bucket.rate : null,
      dateSuffix,
    });
    lines.push({
      description,
      // Round the summed hours once at line level for display; the
      // amount stays exact (sum-of-rounded-amounts).
      quantity: Math.round(bucket.hours * 100) / 100,
      unitPrice: bucket.rate,
      amount: Math.round(bucket.amount * 100) / 100,
      sourceEntryIds: bucket.ids,
    });
  }

  // Stable order: by description (alphabetical) — keeps the preview
  // and posted invoice rendering in the same order across reloads.
  // For `detailed` mode, secondary sort on the first source entry's
  // date would be more useful, but the description already encodes
  // the entry's user input which is usually unique enough.
  lines.sort((a, b) => a.description.localeCompare(b.description));
  return lines;
}

/**
 * Build the base label (without rate suffix or date range) for a
 * bucket. Mode-aware:
 *   - by_project: `[CODE] Project Name`
 *   - by_task:    `[CODE] Project Name: Task` (or `Time` when null)
 *   - by_person:  `[CODE] Project Name — Person`
 *   - detailed:   user note (if any), else `[CODE] Project Name`
 */
function baseLabel(
  entry: EntryCandidate,
  mode: InvoiceGroupingMode,
): string {
  const projectPart = formatProjectPart(entry);
  switch (mode) {
    case "by_project":
      return projectPart;
    case "by_task": {
      const task = entry.taskName ?? "Time";
      return `${projectPart}: ${task}`;
    }
    case "by_person":
      return `${projectPart} — ${entry.personName}`;
    case "detailed": {
      const note = entry.description?.trim();
      return note && note.length > 0 ? note : projectPart;
    }
  }
}

/** `[CODE] Project Name` when code is set, else `Project Name`. */
function formatProjectPart(entry: EntryCandidate): string {
  if (entry.projectInvoiceCode) {
    return `[${entry.projectInvoiceCode}] ${entry.projectName}`;
  }
  return entry.projectName;
}

/** `(MM/DD/YYYY – MM/DD/YYYY)` or `(MM/DD/YYYY)` when min == max.
 *  Empty string when no dates available (orphan / source deleted). */
function formatDateRange(
  minDate: string | null,
  maxDate: string | null,
): string {
  if (!minDate || !maxDate) return "";
  if (minDate === maxDate) {
    return `(${formatLineDate(minDate)})`;
  }
  return `(${formatLineDate(minDate)} – ${formatLineDate(maxDate)})`;
}

/** ISO YYYY-MM-DD → MM/DD/YYYY. Locale-aware formatting is a known
 *  follow-up; for now en-US matches the rest of the PDF. */
function formatLineDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** Compose the final description string. Order: `<base> [@ <rate>] <dateSuffix>`. */
function composeDescription(input: {
  base: string;
  rate: number | null;
  dateSuffix: string;
}): string {
  const parts: string[] = [input.base];
  if (input.rate !== null) {
    parts.push(`(@ ${formatRateForLabel(input.rate)})`);
  }
  if (input.dateSuffix) {
    parts.push(input.dateSuffix);
  }
  return parts.join(" ");
}

/**
 * Format a rate as a short label suffix for mixed-rate splits.
 * Plain "$150/hr" — same shape Harvest uses on its line items.
 */
function formatRateForLabel(rate: number): string {
  return `$${rate.toFixed(2)}/hr`;
}
