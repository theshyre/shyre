# Bookkeeper

## Role

The accountant or bookkeeper who doesn't use Shyre daily but has to reconcile it with QuickBooks / taxes / 1099s once a month or once a quarter. Either the business owner wearing a second hat, or an external professional given read-only access.

## What they care about

- **Exports that don't lie.** Row counts, totals, and category totals on the export must match what's shown in the UI. Off-by-one, timezone drift, or "this year" starting at the wrong date are catastrophic at tax time.
- **Standard categories that map to tax categories.** The expense categories must map to something an accountant recognizes (meals, travel, software, professional services…). Arbitrary free text breaks reconciliation.
- **1099 boundaries.** Contractor vs employee, reimbursement vs expense, billable vs non-billable — these distinctions matter for IRS paperwork and can't be muddled.
- **Audit trail, not editable history.** If an invoice was sent on March 3 for $5,000, changing it to $5,200 next week without leaving a mark is fraud territory.
- **Closed periods stay closed.** Once the books are closed for Q1, edits to Q1 data should either be blocked or loudly flagged.
- **Currency and rounding determinism.** Every dollar figure rounds the same way, every time. Mixed numeric and currency types hiding implicit casts are landmines.
- **Clear separation of "recorded" vs "billed" vs "paid".** Reports and queries must be able to tell them apart.
- **Counts and totals come from aggregate queries, not `array.length`.** Period sums, "this month" chips, export counts, "matching" badges, and bulk-action labels must derive from a filter-scoped DB sum / count — never from rendered or paginated rows. A UI number that depends on pagination is a number that lies under audit. (Surfaced by the expenses-page review where `monthTotalLabel` was being computed from the filtered+paginated client array.)
- **Default period filters on financial pages don't pick the calendar year.** Q1 of any year is prior-year reconciliation; defaulting to "current year" forces a fight every January–April. Prefer rolling-N-month, "since last close", or "remembered last selection."
- **Bulk actions follow filtered-set semantics, not page-only.** Excel/Sheets convention: "select all" on a filter operates on all matching rows. QuickBooks page-only is the outlier and it should not be Shyre's behavior. If pagination is in play, the UI must be explicit about scope (Gmail two-step), and the action must re-apply the filter server-side rather than operate on a client-supplied ID list of just the rendered page.

## Review checklist

When reviewing a change, flag:

- [ ] **Export totals round-trip?** Sum of rows = displayed total, to the cent, across all filters.
- [ ] **Category / tag taxonomy changed?** Any rename, split, or merge must be handled for historic rows (don't silently remap).
- [ ] **Storing money as float?** Only numeric(10,2) or integer-cents. Never float/double.
- [ ] **Invoice mutation leaves history?** `edited_at`, `previous_amount`, immutable `sent_on` — don't destructively overwrite.
- [ ] **New "billable" / "reimbursable" / "deductible" boolean?** Document what it means and how it's used in reports.
- [ ] **Timezone used consistently for "this month" / "Q1"?** Business's fiscal year, not UTC, not browser-local.
- [ ] **Deletion vs void?** Voiding an invoice must preserve the record with a void marker. True delete only for drafts.
- [ ] **Report period labels unambiguous?** "2026-Q1" beats "Q1" beats "this quarter" — labels must survive a PDF print.
- [ ] **Period totals + count badges from a separate filter-scoped query?** Never from `rendered.length` / `loaded.reduce` — those break under pagination and any partial filter.
- [ ] **Default-period filter on financial surfaces avoids calendar-year as the default?** Q1 work is prior-year work; current-year default forces a click on every page load through tax season.
- [ ] **Bulk action on filtered + paginated list re-applies the filter server-side?** "Select all matching" should call the action with the filter spec, not with a 50-ID list of the rendered page.
