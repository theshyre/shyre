/**
 * Invoice status transition graph + helpers.
 *
 * The DB CHECK constraint on `invoices.status` validates that the
 * *value* is one of `draft|sent|paid|void|overdue`. This module
 * validates the *transition* — paid → draft would silently unwind a
 * billed invoice, void → sent would un-cancel one, etc. Pure logic
 * (no DB / no auth) so it's directly unit-testable.
 *
 * Transition graph:
 *
 *     draft  ─┬─►  sent  ─┬─►  paid  (terminal — no transitions out)
 *             │           ├─►  void  (terminal)
 *             │           └─►  overdue
 *             └─►  void   (terminal)
 *
 *   overdue  ─┬─►  paid   (terminal)
 *             └─►  void   (terminal)
 *
 * Reverse transitions (paid → draft, void → sent, overdue → draft,
 * etc.) are *all* rejected. Correcting a mistake (e.g. someone hit
 * "Mark Paid" by accident) needs a separate audited path — it
 * shouldn't ride on the same generic status-change action.
 */

export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "paid",
  "void",
  "overdue",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

const ALLOWED_NEXT: Record<InvoiceStatus, ReadonlySet<InvoiceStatus>> = {
  draft: new Set(["sent", "void"]),
  sent: new Set(["paid", "void", "overdue"]),
  overdue: new Set(["paid", "void"]),
  paid: new Set(),
  void: new Set(),
};

/** True iff `next` is a permissible follow-on to `current`. Same-status
 *  no-ops (`current === next`) return false — callers should guard
 *  for that themselves; transitioning a row to its current status is
 *  almost always a UI bug, not an intended action, and rejecting it
 *  surfaces the bug. */
export function isValidInvoiceStatusTransition(
  current: string,
  next: string,
): boolean {
  if (!isInvoiceStatus(current) || !isInvoiceStatus(next)) return false;
  if (current === next) return false;
  return ALLOWED_NEXT[current].has(next);
}

/** Return the set of statuses a row at `current` can transition to.
 *  UI uses this to render only the buttons that would actually
 *  succeed — no point showing "Mark Paid" on a void invoice. */
export function allowedNextStatuses(current: string): InvoiceStatus[] {
  if (!isInvoiceStatus(current)) return [];
  return Array.from(ALLOWED_NEXT[current]);
}

/** Read-time "overdue" computation. A `sent` invoice past its
 *  `due_date` displays as `overdue` even if no one has clicked
 *  "Mark Overdue" yet — bookkeepers expect the AR aging report to
 *  reflect today's reality, not stale state. We don't *mutate* the
 *  row at read time (that would be racy and would obscure when the
 *  user actually intervened); we just project the effective status
 *  for display.
 *
 *  Pass `today` as YYYY-MM-DD in the viewer's local timezone. The
 *  caller decides what "today" means — server actions use UTC,
 *  pages can use the viewer's TZ if known. Comparison is
 *  string-based on YYYY-MM-DD which is lexicographic = chronological.
 */
export function effectiveInvoiceStatus(
  storedStatus: string,
  dueDate: string | null,
  today: string,
): InvoiceStatus {
  const status = isInvoiceStatus(storedStatus) ? storedStatus : "draft";
  if (status === "sent" && dueDate && dueDate < today) {
    return "overdue";
  }
  return status;
}
