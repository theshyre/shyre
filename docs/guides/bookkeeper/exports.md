# Exports

Every entity that matters for reconciliation has a CSV export. Totals on the export match totals in the UI, to the cent.

## What's exportable today

- **Time entries** — Time page → **Export** button (top right). Respects current filters (org, week, billable, category).
- **Customers** — Customers page → **Export** (planned — currently manual via DB if needed; tell the admin).
- **Invoices** — Invoices page → **Export** (in progress).
- **Expenses** — Expenses page → **Export CSV** button. Respects current filters (team, date range, category, project, billable, and the free-text search).

## Time entries CSV format

Columns:
- `id`
- `user_id`
- `user_email`
- `team_id`
- `team_name`
- `customer_id`
- `customer_name`
- `project_id`
- `project_name`
- `category_id`
- `category_name`
- `description`
- `start_time` (ISO 8601 UTC)
- `end_time` (ISO 8601 UTC)
- `duration_min`
- `duration_hours` (rounded to 2dp)
- `billable` (true/false)
- `github_issue`
- `invoiced` (true/false)
- `invoice_id`

Downloaded as `time-entries-YYYY-MM-DD.csv`.

## Expenses CSV format

Columns: `expense_id`, `incurred_on`, `team`, `team_id`, `vendor`, `amount`, `currency`, `category`, `billable`, `project`, `project_id`, `customer`, `customer_id`, `description`, `notes`, `external_reference`, `imported_from`, `imported_at`, `created_at`, `deleted_at`, `user_id`, `business_id`.

Downloaded as `shyre-expenses-YYYY-MM-DD.csv`.

- **`external_reference`** is the expense's external identifier (vendor invoice #, PO #, order/receipt #). It exports verbatim. `notes` is exported too — for older rows the identifier may still live there (see the Expenses feature guide's cutover note), and the export search matches both, so a filtered export returns exactly the rows the page shows.
- **Excel / Sheets caveat:** a reference like `0012345` (leading zeros) or a long all-digit confirmation number can be re-formatted by a spreadsheet on open (leading zeros dropped, long digit strings shown as `1.2E+15`). The CSV *bytes* are correct and match the UI exactly; to preserve the display, import the column as **Text** rather than letting the spreadsheet auto-detect the type.

## Invariants

These hold for every export, always:

1. Sum of `duration_hours` × rate per line = amount shown on the invoice (where invoiced).
2. Sum of `duration_min` across all rows for a period = the period total shown on the UI.
3. Category names are snapshots at export time — a later rename of the category won't retroactively change the CSV.
4. Timezone: `start_time` and `end_time` are always UTC. Day boundaries in the UI use the operator's business fiscal-year / timezone setting.

## For QuickBooks / tax software

Direct integration with QuickBooks isn't built yet. Workflow today:

1. Export time entries CSV for the period.
2. Pivot in a spreadsheet: group by customer, sum hours, multiply by rate.
3. Paste into QuickBooks as a journal entry, or generate invoices from it.

Direct QB Online sync is on the roadmap.

## Money and rounding

- All money is stored as `numeric(10,2)` (fixed-point). No floats.
- Display uses `Intl.NumberFormat` with the locale's decimal rules.
- Rounding is banker's rounding ("round half to even"), applied once at display time.

## Related

- Feature guide: [invoicing](../features/invoicing.md)
- [Period close](period-close.md)
- [Reference: database schema](../../reference/database-schema.md)
