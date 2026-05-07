# Expenses

Business expenses — subscriptions, hardware, travel, meals, fees. Tracked per team, with optional links back to projects for billable-to-customer expenses.

## Where it lives

Sidebar → **Business** → **Expenses** tile → `/business/expenses`. The tile on `/business` shows this month's count and total at a glance.

## Summary tiles

Above the Add-expense form, four KPI tiles show totals for: **Year to date**, **This month**, **Last month**, and **This quarter**. Click a tile to apply that date range as a filter — click again to clear it. The active tile is highlighted. Other filters you've set (search, category, project, billable) are preserved when you toggle a tile.

## Adding an expense

1. Press `N` or click **Add expense**
2. Fill in:
   - **Date** — defaults to today
   - **Amount**
   - **Category** — one of: Software, Hardware, Subscriptions, Travel, Meals, Office, Professional services, Fees, Other
   - **Vendor** — optional (e.g. "AWS", "Chipotle")
   - **Description** — optional
   - **Project** — optional; link to a project for billable-to-customer expenses
   - **Billable** — checkbox; marks this as billable back to a customer
3. Save.

## Editing / deleting

Two ways to edit:

- **In-table cells** — click any cell (date, amount, category, vendor, description, notes, project, billable). Date cells open a calendar widget; everything else commits on blur (Tab or click out). Cmd+Enter also commits, Esc cancels.
- **Expand row** — click the chevron in the row's actions column. The row expands inline (between its neighbors) to reveal full-width Description and Notes textareas plus all other fields with breathing room. Click the chevron again or press Esc to collapse. Same commit-on-blur semantics. The expansion is deep-linkable: `/business/.../expenses?edit=<expense-id>` opens that row already expanded.

Delete with the trash icon — a small inline confirm appears (no modal).

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

Categories map to the IRS schedule-C-ish buckets most bookkeepers use. Fixed enum for now; ping the admin if you need a new one added to the list.

## Who can do what

- **Any org member** can see expenses for the org
- **Authors** can edit/delete their own
- **Owners / admins** can edit/delete any expense in the org

## Currency

Currently USD-only (stored but not user-changeable). Multi-currency is planned but not shipped.

## Related

- [Business identity](business-identity.md)
- [Projects](projects.md) — link billable expenses to projects
- Bookkeeper's [exports guide](../bookkeeper/exports.md)
