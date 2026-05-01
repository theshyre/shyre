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
  taskName: string | null;
  personName: string;
  /** ISO date (YYYY-MM-DD) the entry was logged. Used for
   *  detailed-mode descriptions and period_start / period_end
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

interface GroupKey {
  /** Stable key used for the Map; grouping mode + logical id + rate. */
  key: string;
  /** Display label for the line, before rate-split disambiguation. */
  label: string;
}

function keyForEntry(
  entry: EntryCandidate,
  mode: InvoiceGroupingMode,
): GroupKey {
  switch (mode) {
    case "by_task":
      return {
        key: `task:${entry.taskName ?? "__no_task__"}`,
        label: entry.taskName ?? "Time",
      };
    case "by_person":
      return {
        key: `person:${entry.personName}`,
        label: entry.personName,
      };
    case "by_project":
      return {
        key: `project:${entry.projectName}`,
        label: entry.projectName,
      };
    case "detailed":
      // Each entry is its own line — key has the entry id so no
      // collapse happens. Description prefers the user's note.
      return {
        key: `entry:${entry.id}`,
        label:
          (entry.description?.trim()?.length ?? 0) > 0
            ? entry.description!.trim()
            : entry.projectName,
      };
  }
}

interface BucketRow {
  label: string;
  rate: number;
  hours: number;
  amount: number;
  ids: string[];
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
    const { key, label } = keyForEntry(entry, mode);
    const rateCents = Math.round(entry.rate * 100);
    const bucketKey = `${key}::${rateCents}`;
    const hours = minutesToHours(entry.durationMin);
    const entryAmount = calculateLineItemAmount(hours, entry.rate);
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        label,
        rate: entry.rate,
        hours: 0,
        amount: 0,
        ids: [],
      };
      buckets.set(bucketKey, bucket);
    }
    bucket.hours += hours;
    bucket.amount += entryAmount;
    bucket.ids.push(entry.id);
  }

  // Detect rate-split: if multiple buckets share the same label,
  // we hit the mixed-rate case. Append the rate to those labels so
  // the user sees why one project produced two lines.
  const labelCounts = new Map<string, number>();
  for (const b of buckets.values()) {
    labelCounts.set(b.label, (labelCounts.get(b.label) ?? 0) + 1);
  }

  const lines: GroupedLineItem[] = [];
  for (const bucket of buckets.values()) {
    const isSplit = (labelCounts.get(bucket.label) ?? 0) > 1;
    const description = isSplit
      ? `${bucket.label} (@ ${formatRateForLabel(bucket.rate)})`
      : bucket.label;
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
 * Format a rate as a short label suffix for mixed-rate splits.
 * Plain "$150/hr" — same shape Harvest uses on its line items.
 */
function formatRateForLabel(rate: number): string {
  return `$${rate.toFixed(2)}/hr`;
}
