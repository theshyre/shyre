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
