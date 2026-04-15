# Period close

Process for closing books for a period (month, quarter, fiscal year) in Shyre.

## Status today

Shyre does not have an explicit "close the period" control yet. What exists:

- Invoices have immutable send history (sent invoices can only be voided, not deleted).
- Time entries are freely editable. There's no "freeze" mechanism.
- Audit trail for mutations is basic (`created_at` on everything; full edit history is planned).

## Recommended month-end workflow

Until a formal close control ships:

1. **Day 1 of the new month**: export time entries for the prior month via the Time page export.
2. Save the CSV in your bookkeeping folder, named by period (e.g. `time-entries-2026-03.csv`).
3. Generate invoices for the prior month. Once sent, they're effectively frozen — void only.
4. Reconcile in QuickBooks / Xero using the CSVs.
5. Keep the CSVs. If a dispute arises, you have the snapshot from close.

## What's coming

- **Period close control** — lock time entries in a period so late edits require explicit re-open with an audit entry.
- **Edit history** — who changed what, when, and the prior value. Especially for invoices.
- **Fiscal year auto-rollover** based on `organization_settings.fiscal_year_start`.

## Fiscal year

Set `fiscal_year_start` (MM-DD) in [Business identity](../solo/business-identity.md). Reports respect this when showing "this fiscal year" or "last quarter".

## Related

- [Exports](exports.md)
- Solo guide: [business identity](../solo/business-identity.md)
