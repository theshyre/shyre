# Expenses

Business expenses — subscriptions, hardware, travel, meals, fees. Tracked per team, with optional links back to projects for billable-to-customer expenses.

## Where it lives

Sidebar → **Business** → pick your business → **Expenses** tab → `/business/<businessId>/expenses`. The business card on `/business` shows the period's expense total at a glance.

## Summary tiles

Above the Add-expense form, four KPI tiles show totals for: **Year to date**, **This month**, **Last month**, and **This quarter**. Click a tile to apply that date range as a filter — click again to clear it. The active tile is highlighted. Other filters you've set (search, category, project, billable) are preserved when you toggle a tile.

## Adding an expense

1. Press `N` or click **Add expense**
2. Fill in:
   - **Date** — defaults to today
   - **Amount**
   - **Category** — one of: Software, Hardware, Subscriptions, Travel, Meals, Office, Professional services, Fees, Other
   - **Vendor** — optional (e.g. "AWS", "Chipotle"). As you type, vendors you've used before suggest in a dropdown — pick one to keep spelling consistent, or just keep typing a new name.
   - **Reference #** — optional. Any unique identifier the expense carries: a vendor invoice number, a PO number, an order or receipt number. Stored exactly as typed (prefixes and leading zeros preserved) so it matches a search of your card or bank statement.
   - **Description** — optional
   - **Project** — optional; link to a project for billable-to-customer expenses
   - **Billable** — checkbox; marks this as billable back to a customer
3. Save.

## Vendor suggestions

The Vendor field suggests vendors you've entered before (scoped to the team — or, on a project page, the project's team). It's a convenience, not a constraint: free text is always accepted, so a vendor that isn't in the list yet just gets typed in. Suggestions de-dupe case-insensitively, so picking "AWS" consistently keeps it from fragmenting into "aws" / "Amazon Web Services" across rows — which keeps reports and search clean.

## Reference # (invoice / order / receipt number)

Each expense has a single, free-text **Reference #** for its external identifier — whatever number the vendor's document carries (invoice #, PO #, order #, receipt #, confirmation code). One generic field on purpose: at reconciliation time you match on the *number*, not on what kind of number it is.

- It's **searchable** — type the number into the expenses search box to jump straight to the row (handy when a card statement shows a charge and you want the matching expense).
- It's editable everywhere the row is: the add form, the inline expanded row.
- It rounds-trips to **CSV export** as its own `external_reference` column.

> **Cutover note.** Before this field existed, people often put these numbers in **Notes**. Existing notes were left untouched (no automatic migration), so for older expenses the number may still be in Notes — both Notes and Reference # are searched, so either way you can still find it. New expenses should use Reference #; Notes is now for free-form context (vendor confirmation details, approval notes).

## Editing / deleting

Two ways to edit:

- **In-table cells** — click any cell (date, amount, category, vendor, description, notes, project, billable). Date cells open a calendar widget; everything else commits on blur (Tab or click out). Cmd+Enter also commits, Esc cancels.
- **Expand row** — **double-click anywhere on the row** (except a cell you're editing or an action button), or click the chevron in the actions column. The row expands inline (between its neighbors) to reveal full-width Description and Notes textareas plus all other fields with breathing room. Click the chevron again or press Esc to collapse. Same commit-on-blur semantics. The expansion is deep-linkable: `/business/.../expenses?edit=<expense-id>` opens that row already expanded.

Delete with the trash icon — a small inline confirm appears (no modal).

**Invoiced rows are FIELD-level locked.** Once an expense lands on a
live invoice (`expenses.invoiced = true`), the invoice has *snapshotted*
it — the invoice's line text and amount are frozen, so they don't
change if you edit the expense afterward. Accordingly:

- **Editable** while invoiced (internal metadata the invoice doesn't
  render): Reference #, Description, Notes, Vendor, Category. Edit them
  inline or in the expanded row exactly as usual.
- **Locked** while invoiced (the financial facts the invoice billed):
  Amount, Currency, Project, Billable, and **Date** (`incurred_on`).
  These cells render read-only with a **lock icon + "Locked — on
  invoice #INV-XXXX"** reason. Delete and split are still fully blocked.

`Date` is locked with the financial fields on purpose: it's baked into
the invoice line and a date change can silently shift a billed expense
across an accounting period. To change any locked field, **void the
invoice first** (releases every expense + time entry on it for editing).

Enforcement is in three layers that must agree: the per-field UI lock,
the `updateExpenseFieldAction` allow-list, and the DB trigger
`tg_expenses_invoice_lock_guard` (default-deny — only the metadata
columns may differ on an invoiced row; the trigger backstops direct
supabase-js writes). The TS allow-list and the trigger are pinned
together by `expense-lock-parity.test.ts`. Every edit to an invoiced
row is captured in the `expenses_history` audit trail (owner/admin
only). Soft-delete restore is still allowed (recovery never affects
the invoice the row is on).

## Bulk actions

Select multiple rows via the checkboxes; a strip appears above the table:

- **Set category** — re-categorize many rows at once
- **Set project** — link a batch of expenses to a project
- **Set billable** — flip the billable flag (Yes / No / Clear)
- **Delete selected** — soft-delete with Undo toast

The checkbox in the header is indeterminate when only some rows are selected; click it to toggle all-or-none. With filters active, a "Select all N matching" link extends the selection beyond the visible page.

## "Recategorize N" banner

If any expenses sit in the **Other** category, a banner above the table shows the count with a one-click **Recategorize N** link that filters the table down to just those rows so you can sweep them in one pass.

## Sample data

If you've loaded sample data from `/admin/sample-data`, you'll see a green "sample" badge next to those rows. They're safe to ignore or delete without affecting real data.

## Categories and tax

Categories map to the IRS schedule-C-ish buckets most bookkeepers use. Fixed enum for now; ping the admin if you need a new one added to the list. See [Expense categories](expense-categories.md) for which category fits which kind of expense, with examples.

## Who can do what

- **Any org member** can see expenses for the org
- **Authors** can edit/delete their own
- **Owners / admins** can edit/delete any expense in the org

## Currency

Currently USD-only (stored but not user-changeable). Multi-currency is planned but not shipped.

## On an invoice

When you create an invoice for a customer, billable + uninvoiced
expenses linked to that customer's projects flow onto the invoice
as discrete line items — see
[Invoicing → Including billable expenses](invoicing.md#including-billable-expenses-phase-2).

Once an expense lands on an invoice, the row is **field-level** locked
(see [Editing / deleting](#editing--deleting) for the full split):

- The expense row keeps its **Invoiced #INV-XXXX** chip (links to the
  invoice) AND its expand control, so you can still open it to edit the
  unlocked metadata (Reference #, Description, Notes, Vendor, Category).
- The financial fields (Amount, Currency, Project, Billable, Date) are
  read-only with a lock reason; delete and split stay fully blocked.
- Restore (recover from soft-delete) is still allowed — recovery never
  affects the invoice that already references the row.

To change a *locked* field, **void the invoice first** through the
invoice detail page's actions menu. Voiding releases every expense
(and time entry) on that invoice for further edits.

## Related

- [Expense categories](expense-categories.md) — which category fits which expense
- [Expense CSV import](expense-csv-import.md) — bulk-import historical expenses from a spreadsheet
- [Business identity](business-identity.md)
- [Projects](projects.md) — link billable expenses to projects
- [Project page → Expenses section](projects.md#expenses-on-a-project) — read + add + delete project-scoped expenses inline on the project detail page
- [Invoicing → Including billable expenses](invoicing.md#including-billable-expenses-phase-2) — the new-invoice flow folds billable expenses in alongside time entries
- Bookkeeper's [exports guide](../bookkeeper/exports.md)
