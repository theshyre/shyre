/**
 * Allow-lists for invoice fields whose values are CHECK-constrained
 * in the DB. Mirrored in src/__tests__/db-parity.test.ts so a
 * mismatch fails CI before it ships.
 */

/** How line items are collapsed at invoice creation. Mirrors
 *  Harvest's terminology so users moving from Harvest don't have
 *  to relearn the vocabulary. */
export const ALLOWED_INVOICE_GROUPING_MODES = new Set<string>([
  "by_task",
  "by_person",
  "by_project",
  "detailed",
]);

export type InvoiceGroupingMode =
  | "by_task"
  | "by_person"
  | "by_project"
  | "detailed";
