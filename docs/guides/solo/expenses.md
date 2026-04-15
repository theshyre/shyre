# Expenses

Business expenses — subscriptions, hardware, travel, meals, fees. Tracked per organization, with optional links back to projects for billable-to-customer expenses.

## Where it lives

Sidebar → **Business** → **Expenses** tile → `/business/expenses`. The tile on `/business` shows this month's count and total at a glance.

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

Click the pencil icon on any row to edit in place. Cmd+Enter saves, Esc cancels. Delete with the trash icon — a small inline confirm appears (no modal).

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
