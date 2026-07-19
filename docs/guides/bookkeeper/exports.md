# Exports

Every entity that matters for reconciliation has a CSV export. Totals on the export match totals in the UI, to the cent.

## What's exportable today

- **Time entries** — Time page → **Export** button (top right). Respects the team filter, billable filter, and the current day/week view + anchor date. (The category filter is not applied to the export.)
- **Customers** — Customers page → **Export CSV** button. Honors the current filter, includes inactive customers, and carries an `inactive_at` column.
- **Invoices** — Invoices page → **Export CSV** button.
- **Expenses** — Expenses page → **Export CSV** button. Respects current filters (team, date range, category, project, billable, and the free-text search).

## Time entries CSV format

Columns (human-readable headers, in order): `Date (UTC)`, `Start (UTC)`, `End (UTC)`, `Duration (min)`, `Project`, `Client`, `Category`, `Category Set`, `Period Budget Type`, `Period Budget Hours Cap`, `Period Budget Dollars Cap`, `Description`, `Billable`, `GitHub Issue`, `Ticket Key`, `Ticket Provider`, `Start ISO 8601`, `End ISO 8601`, `Entry ID`, `User ID`, `User`, `Team ID`, `Project ID`, `Customer ID`, `Invoice ID`, `Invoiced`, `Source`.

- `Source` records who logged the entry — human, agent (with the agent label), integration, or import. See [agent attribution](../features/agent-attribution.md).
- There is no hours column; compute hours as `Duration (min) / 60`.

Downloaded as `shyre-time-<rangeStart>-to-<rangeEnd>.csv`.

## Invoices CSV format

Columns: `invoice_id`, `invoice_number`, `team`, `customer`, `customer_email`, `status`, `issued_date`, `due_date`, `sent_at`, `paid_at`, `voided_at`, `currency`, `subtotal`, `discount_rate`, `discount_amount`, `tax_rate`, `tax_amount`, `total`, `payments_total`, `amount_due`, `imported_from`, `notes`, `customer_id`, `team_id`.

- `status` is the **effective** status — a past-due `sent` invoice exports as `overdue`.
- `amount_due` = `total − payments_total`; payments in a different currency than the invoice are skipped from `payments_total` rather than mis-summed.

Downloaded as `shyre-invoices-YYYY-MM-DD.csv`.

## Expenses CSV format

Columns: `expense_id`, `incurred_on`, `team`, `team_id`, `vendor`, `amount`, `currency`, `category`, `billable`, `project`, `project_id`, `customer`, `customer_id`, `description`, `notes`, `external_reference`, `imported_from`, `imported_at`, `created_at`, `deleted_at`, `user_id`, `business_id`.

Downloaded as `shyre-expenses-YYYY-MM-DD.csv`.

- **`external_reference`** is the expense's external identifier (vendor invoice #, PO #, order/receipt #). It exports verbatim. `notes` is exported too — for older rows the identifier may still live there (see the Expenses feature guide's cutover note), and the export search matches both, so a filtered export returns exactly the rows the page shows.
- **Excel / Sheets caveat:** a reference like `0012345` (leading zeros) or a long all-digit confirmation number can be re-formatted by a spreadsheet on open (leading zeros dropped, long digit strings shown as `1.2E+15`). The CSV *bytes* are correct and match the UI exactly; to preserve the display, import the column as **Text** rather than letting the spreadsheet auto-detect the type.

## Invariants

These hold for every export, always:

1. Sum of (`Duration (min)` / 60) × rate per line = amount shown on the invoice (where invoiced).
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
