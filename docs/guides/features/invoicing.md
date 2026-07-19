# Invoicing

Generate and send invoices from tracked time. Late fees, recurring invoices, multi-currency, and payment **collection** (Stripe / ACH) are planned; payment **recording** is built (see below).

## Creating an invoice

1. Sidebar → **Invoices**
2. Click **New invoice**
3. Pick the customer
4. Shyre shows uninvoiced, billable time entries for that customer. Select the date range (chips below) and, when the customer has sub-projects, optionally scope to a subset via the **project chips**.
5. Pick a **grouping mode** — by project, by task, by person, or detailed (one line per entry). The choice persists for next time. Line amounts are derived (hours × rate); there is no per-line manual override — use a detailed grouping or adjust the underlying entries instead.
6. Optionally add a **discount** — a rate or a fixed amount (amount wins), with a reason.
7. If any selected time was tracked by an **agent**, the **agent-tracked time review** section gates creation — approve or exclude those entries first, and watch for overlap warnings. See [Reviewing agent-tracked time](agent-time-review.md).
8. The **preview rail** shows totals live (including an Agent hours subtotal and warnings for orphaned entries or excluded non-USD expenses); open the full preview modal for the customer-facing render.
9. Click **Create invoice** — the invoice is created as a **draft** and you land on its detail page. Sending is a separate step from there.

### Date-range presets

The **Billable hours to include** chips control which entries the preview pulls in:

- **Since last invoice** *(default once a customer has at least one invoice)* — anchors to the day after the previous invoice's service period. Imported or historical entries from before that anchor stay out of the preview.
- **All uninvoiced** — every entry with `invoiced = false`. Useful for a true catch-up bill, but watch out for legacy / imported entries you don't actually want to bill. See **Excluding imported entries** below.
- **This month / Last month / Last 30 days / Custom** — deliberate window choices, used when you bill on a regular cadence regardless of prior invoices.

When you switch customers, Shyre auto-flips **All uninvoiced** back to **Since last invoice** if the new customer has prior invoices — a safety net against pulling years of imported time into a single bill by accident.

### Excluding imported entries

If you imported historical time (Harvest, CSV, etc.) for work that was already billed in another system, those entries land in Shyre with `invoiced = false` and would otherwise sit in the **All uninvoiced** bucket forever.

To clean them up:

1. **Time** sidebar → switch to **Table** view (top-right toggle).
2. Pick the customer via the **Customer** chip in the toolbar (e.g. "EyeReg Consulting").
3. Set **From** to before the earliest imported entry (e.g. `01/01/2018`) and **To** to today. No upper cap on the span — the 500-row server cap is the safety net.
4. Set **Invoice status** to **Uninvoiced**.
5. Use the master checkbox in the table header to select all matching rows.
6. In the bulk-action strip, click **Mark as billed elsewhere** → confirm.

The entries flip to `invoiced = true` while staying detached from any actual invoice. They drop out of the Create-invoice preview immediately. The Undo toast at the bottom of the screen lets you reverse the flip for a few seconds if you mis-clicked.

Marked rows can still be edited (description, duration) — the "billed elsewhere" state hides them from invoicing without freezing them.

To un-mark later: today the only path is the Undo toast that appears right after the bulk action — click "Undo" within a few seconds and the flip is reversed. A persistent "un-mark as billed elsewhere" affordance is on the Phase 2 roadmap; filter the Table view's **Invoice status** chip to **Billed elsewhere** to find rows in that state for now.

## Including billable expenses (phase 2)

When you create an invoice for a specific customer, Shyre also pulls
in **uninvoiced billable expenses** logged against that customer's
projects. They land as discrete line items alongside the time
entries — each expense is one line (expenses aren't grouped the way
time entries are).

- **Toggle**: in the new-invoice form, the **Include billable
  expenses** checkbox controls this. On by default. Toggle off for
  a time-only invoice when you want to bill expenses separately or
  on a different cycle.
- **Scope**: only expenses where `billable = true`, `invoiced = false`,
  `currency = 'USD'`, and whose linked project's `customer_id`
  matches the invoice's customer. Internal-project expenses are
  excluded.
- **Date range**: the same range chips that filter time entries also
  filter expenses by `incurred_on`.
- **Preview rail**: shows expense count + total beneath the hours
  block when expenses are folded in. The grand total includes them
  to the cent (matches the posted invoice). When non-USD expenses
  exist that would have matched (currency mismatch), a small
  "N non-USD expense(s) excluded — phase 2 invoices USD only"
  warning surfaces in the rail so silently-dropped money is visible.
- **Description format**: multi-line so every customer-meaningful
  field from the expense row carries through. Order of parts:
    1. `[CODE] <vendor>` (or humanized category as a fallback when no vendor)
    2. The expense's **description** (when present)
    3. The expense's **notes** (when present — typically the order number, invoice reference, license key)
    4. `(YYYY-MM-DD)`
  Example for a Microsoft Windows 10/11 Pro purchase: `[PC-ITOPS] Microsoft\nWindows 10/11 Pro\nOrder Number: 4170476167 LAP-PF4C0CKG\n(2026-05-28)` — four lines in the preview, the detail page, and the PDF.
- **Services and Expenses are visually separated** on every render
  surface (preview rail's full modal, invoice detail page, and the
  customer-facing PDF). Two stacked tables: **Services** with
  Description / Hours / Rate / Amount, **Expenses** with just
  Description / Amount (Qty / Rate are time-specific concepts that
  read awkwardly when every row is Qty 1 / Rate = full Amount).
  Section headers ("SERVICES" / "EXPENSES") render only when both
  sections are present — a time-only or expense-only invoice keeps
  a single table with no awkward solo banner.
- **Org-wide invoices** (no customer selected) don't include
  expenses — phase 2 has no "non-project" expense bucket.

### Invoiced expenses are locked

Once an expense lands on an invoice (`expenses.invoiced = true`),
the action layer refuses to update, delete, or split it. The
project-page expense row renders an **Invoiced #INV-XXXX** chip
(link to the invoice) and the row's delete affordance hides. To
edit the expense, **void the invoice first** — same pattern as
invoiced time entries.

Restoring a soft-deleted invoiced expense is still allowed:
recovery never affects the invoice it's already on.

## Statuses

- **Draft** — editable, not sent, not counted in AR
- **Sent** — you've delivered it (via email, PDF, or manually)
- **Paid** — customer paid; should never regress
- **Overdue** — past due date
- **Void** — cancelled; preserves the record for audit

## Recording a payment

When a customer pays, open the invoice and click **Record payment**. An inline form opens with four fields:

- **Amount** — defaults to the outstanding balance. Edit it for partial payments.
- **Paid on** — defaults to today; change it to the actual date you received payment. This is what gets recorded in your books, not when you happened to click the button.
- **Method** *(optional)* — ACH, wire, check, cash, card, Stripe, PayPal, or anything else you want to type.
- **Reference** *(optional)* — a check number, ACH trace, Stripe charge ID, or any other lookup string.

`Cmd+Enter` submits; `Escape` cancels.

The invoice's status flips to **Paid** as soon as the recorded payments sum to (or exceed) the invoice total. Until then it stays **Sent** or **Overdue** with the partial payment(s) showing in the activity log. The `paid_at` timestamp on the invoice is the **Paid on** date of the payment that crossed the line — not the moment you clicked Record, so a Tuesday-click on a Friday-receipt produces correct cash-basis numbers.

Restricted to **owners and admins**. Members can view payments but can't record them.

### When you can record payments

- **Sent**, **Overdue** — normal case
- **Paid** — extra payments are allowed for overpayments / corrections; the status doesn't change
- **Draft** — rejected; there's no real bill yet
- **Void** — rejected; the invoice is cancelled

### Period locks

If the **Paid on** date falls inside a locked accounting period, the server rejects the insert with the lock's reason. Pick a date inside an open period, or unlock the period if you're an owner. See [Period locks](period-locks.md).

## Correcting a paid date

If an invoice ended up with the wrong paid date — common on invoices marked via the legacy one-click button before the Record Payment form existed, or on Harvest imports where the paid date came across as the import date — open the invoice and click **Edit** next to the "Paid on..." label in the header.

The form has two required fields:

- **Paid on** — the corrected date.
- **Reason for change** — minimum 10 characters. Persisted in the audit trail so a future auditor or you-six-months-from-now can see *why* the date moved, not just *that* it moved. The activity log on the same page renders the correction inline.

`Cmd+Enter` submits, `Escape` cancels. Owner/admin only.

### What the system actually does

- Updates `invoices.paid_at` to the new date (UTC midnight of the chosen day).
- Updates the canonical `invoice_payments` row's `paid_on`:
  - **Legacy invoices with no payment row** — creates a synthetic payment row with the new date, amount equal to the invoice total, currency inherited, and method/reference blank (you can complete it later when a payments-edit UI ships).
  - **Single payment row** — updates that row's `paid_on` to the new date.
  - **Two or more payment rows** — rejected. The paid date is defined by whichever payment crossed the total, and Shyre doesn't have a per-payment edit UI yet. The error message names the existing payment dates.

### Validation

Hard rejections:

- Reason shorter than 10 characters.
- New paid date before the invoice's **issued date** (the cash can't precede the bill).
- New paid date in the future.
- New date inside a locked accounting period, OR the *current* paid date is inside a locked period (you can't move a date *out of* a locked period either).
- Caller is not an owner or admin.
- Invoice status is not `paid`.

## Numbering

Invoices are numbered sequentially per team, in the format `INV-{YYYY}-{NNN}`. Numbers can't be reused.

## What goes on the invoice

- **From** block pulled from [Business identity](business-identity.md)
- **To** block pulled from customer's address
- Line items from the time entries you picked
- Amount, rate, hours per line item
- Due date (configurable)

## What isn't built yet

- Recurring invoices
- Late fees
- Multi-currency
- Stripe / ACH payment collection (tracked in project backlog)
- Customer portal to receive invoices

## Void vs delete

Deleting is a two-step, owner/admin-only flow: **void first, then delete**. Only `void` invoices can be hard-deleted (the void records the status transition + actor in the history), and a void invoice with recorded payments refuses deletion so the payment audit trail is never lost. Every other status — draft, sent, paid, overdue — can only be **voided**.

The invoice list also supports **bulk status changes** on selected rows.

## Related

- [Customers](customers.md)
- [Time tracking](time-tracking.md)
- [Proposals](proposals.md) — deposit invoices and fixed-price billing land here as proposal-linked invoices
- [Reviewing agent-tracked time](agent-time-review.md) — the review gate in the invoice builder
- Bookkeeper's [exports guide](../bookkeeper/exports.md)
