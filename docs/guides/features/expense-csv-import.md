# Expense CSV import

> Bulk-import historical business expenses from a CSV (one tab per
> year is fine — import them one at a time). Default category for
> every imported row is **Other**; recategorize on the Expenses page
> before tax reports.

## Where it lives

`/business/[businessId]/expenses` → **Import CSV** button in the
top-right of the page header → opens
`/business/[businessId]/expenses/import`. Owner / admin role on at
least one team in the business required (the button is hidden for
plain members).

The cross-cutting `/import` page hosts only Harvest (which spans
customers, projects, and time entries). Expense-only CSV import
lives on the business's expenses surface where the data goes — it
shouldn't take a Settings → Import detour to upload a CSV that
ends up in one specific business's ledger.

## Required CSV shape

Headers (case-insensitive, any column order):

| Header | Required | Maps to |
|---|---|---|
| `Date` | Yes | `expenses.incurred_on` (parses `M/D/YYYY` and `YYYY-MM-DD`) |
| `Amount` | Yes | `expenses.amount` (strips `$`, commas, whitespace) |
| `Item` | No (recommended) | Split on `" - "` into `vendor` + `description` |
| `Comments` | No (recommended) | `expenses.notes` (multi-line cells supported) |

The `Item` column's vendor split is heuristic: `"Linode - server"`
becomes `vendor="Linode"`, `description="server"`. Items without
`" - "` (e.g. `"Networking equipment from Platt"`) land entirely in
`description` with `vendor=null`. Edit individual rows after import
if the heuristic misfires.

## How to use it

1. From your spreadsheet, **File → Download → CSV** (Google Sheets)
   or copy-paste the cells. One year-tab at a time.
2. On `/import`, find "Import expenses from CSV". Pick a team if
   you have multiple.
3. Drop the `.csv` file or paste rows into the textarea. The page
   shows a parse preview: row count, first 3 rows, and any rows
   that failed to parse (with reasons).
4. Click "Import N expenses." The summary shows how many landed,
   how many were already imported (idempotent re-runs), and any
   rows that failed at insert time.
5. Visit `/business/[businessId]/expenses` and recategorize. A
   warning banner ("N expenses in 'Other' category") stays
   visible until every row has a real category.

## Idempotency

Re-uploading the same CSV does not create duplicates. Each row gets
a deterministic hash of `(date, amount, vendor, description, notes)`
stamped into `import_source_id`; the partial unique index
`(team_id, imported_from, import_source_id)` makes the second insert
a no-op. The summary distinguishes "imported" from "already imported"
so you can see what actually happened.

## Undo

Like the Harvest importer, every CSV import is recorded as an
`import_runs` row. The `/import` history list at the bottom of the
page has an Undo button for each — clicking it hard-deletes every
expense stamped with that run's id. Permanently destructive, no soft
delete: use it within a few minutes of an import you want to redo,
not as a generic "delete a year's worth of expenses" tool.

## Constraints + permissions

- **Role gate.** Owner / admin of the target team only. Plain
  members get a "Only owners and admins can run imports" error.
- **Category default.** Every imported row lands in `category="other"`.
  The CSV doesn't carry categories and the importer does not guess
  from item text (heuristic guesses hide the audit work that needs
  doing). Recategorize manually on the Expenses page.
- **Currency default.** Every imported row lands in `currency="USD"`.
  Multi-currency spreadsheets aren't supported in v1; import them as
  USD and edit the currency per row, or split into per-currency
  CSVs.
- **No project linking.** Imported rows have `project_id=null`. If
  you need to associate an expense with a project for billing, edit
  the row after import.
- **Period locks honored.** A locked period blocks CSV imports the
  same way it blocks manual expense creation. Unlock the period or
  trim the CSV to dates outside the lock first.

## Related

- Source spreadsheet pattern: Date / Amount / Item / Comments
  per-year-tab — the canonical shape this importer is built for.
- Future receipt-email ingestion: see
  [`docs/reference/roadmap.md`](../../reference/roadmap.md). The
  CSV importer is the historical-data path; receipt ingestion
  will be the day-to-day path.
- Expenses feature guide: [`expenses.md`](./expenses.md) for
  manual entry, categories, period locks, soft delete, and undo.
