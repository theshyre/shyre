# Invoicing

Generate and send invoices from tracked time. This surface is early — the basics are in; late fees, recurring invoices, multi-currency, and payment collection are planned.

## Creating an invoice

1. Sidebar → **Invoices**
2. Click **New invoice**
3. Pick the customer
4. Shyre shows uninvoiced, billable time entries for that customer. Select the ones you want on this invoice.
5. Review line items. Amount = hours × rate per entry. Manual override per line is possible.
6. Save as **draft**, or send directly.

### Date-range presets

The **Billable hours to include** chips control which entries the preview pulls in:

- **Since last invoice** *(default once a customer has at least one invoice)* — anchors to the day after the previous invoice's service period. Imported or historical entries from before that anchor stay out of the preview.
- **All uninvoiced** — every entry with `invoiced = false`. Useful for a true catch-up bill, but watch out for legacy / imported entries you don't actually want to bill. See **Excluding imported entries** below.
- **This month / Last month / Last 30 days / Custom** — deliberate window choices, used when you bill on a regular cadence regardless of prior invoices.

When you switch customers, Shyre auto-flips **All uninvoiced** back to **Since last invoice** if the new customer has prior invoices — a safety net against pulling years of imported time into a single bill by accident.

### Excluding imported entries

If you imported historical time (Harvest, CSV, etc.) for work that was already billed in another system, those entries land in Shyre with `invoiced = false` and would otherwise sit in the **All uninvoiced** bucket forever.

To clean them up:

1. Go to **Time entries**
2. Filter / sort to the imported rows
3. Select them via the row checkboxes
4. In the bulk-action toolbar, click the **Mark as billed elsewhere** badge button → confirm
5. The entries flip to `invoiced = true` (but stay detached from any actual invoice). They drop out of the Create-invoice preview. Undo toast lets you reverse within a few seconds if you mis-clicked.

Marked rows can still be edited (description, duration) — the "billed elsewhere" state hides them from invoicing without freezing them. To un-mark later, select them again and the same flow reverses (currently surfaces only via the Undo toast — a permanent un-mark affordance is on the roadmap).

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

Only drafts can be deleted. Sent or paid invoices can only be **voided** — the row is preserved with a void marker so the audit trail stays intact.

## Related

- [Customers](customers.md)
- [Time tracking](time-tracking.md)
- Bookkeeper's [exports guide](../bookkeeper/exports.md)
