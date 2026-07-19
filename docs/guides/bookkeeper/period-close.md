# Period close

Process for closing books for a period (month, quarter, fiscal year) in Shyre.

## Status today

Shyre's close control is **[Period locks](../features/period-locks.md)** — lock a closed accounting period from **Business → Period locks** and retroactive edits to time entries, expenses, and invoices inside the window are blocked at the database layer. Unlocking (to make a correction) is an explicit, audit-logged action.

Alongside the lock:

- Invoices have immutable send history (sent invoices can only be voided, not deleted).
- Time entry deletions are **soft** — every deletion goes through the [Trash](../features/time-tracking.md#the-trash-page) and can be restored. A deleted entry is excluded from reports, totals, exports, and invoicing, but the row still exists in the database with a `deleted_at` timestamp. This matters for reconciliation: if a prior month's total changes after you closed, check the Trash first.
- Mutation history is captured in append-only `_history` tables (time entries, invoices, expenses, and more) — see the [database schema](../../reference/database-schema.md).

## Recommended month-end workflow

1. **Day 1 of the new month**: export time entries for the prior month via the Time page export.
2. Save the CSV in your bookkeeping folder, named by period (e.g. `time-entries-2026-03.csv`).
3. Generate invoices for the prior month. Once sent, they're effectively frozen — void only.
4. Reconcile in QuickBooks / Xero using the CSVs.
5. **Lock the period** on the Period locks page so late edits can't silently move the closed totals.
6. Keep the CSVs. If a dispute arises, you have the snapshot from close.

## What's coming

- **Fiscal year auto-rollover** based on `fiscal_year_start`.

## Fiscal year

Set `fiscal_year_start` (MM-DD) in [Business identity](../features/business-identity.md). Note: the Reports page's period presets (This Month / Quarter / Year, etc.) are **calendar-based (UTC)** today — they do not yet respect `fiscal_year_start`. Use a custom From/To range for a non-calendar fiscal period.

## Related

- [Period locks](../features/period-locks.md)
- [Exports](exports.md)
- Feature guide: [business identity](../features/business-identity.md)
