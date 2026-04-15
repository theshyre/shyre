# Invoicing

Generate and send invoices from tracked time. This surface is early — the basics are in; late fees, recurring invoices, multi-currency, and payment collection are planned.

## Creating an invoice

1. Sidebar → **Invoices**
2. Click **New invoice**
3. Pick the customer
4. Shyre shows uninvoiced, billable time entries for that customer. Select the ones you want on this invoice.
5. Review line items. Amount = hours × rate per entry. Manual override per line is possible.
6. Save as **draft**, or send directly.

## Statuses

- **Draft** — editable, not sent, not counted in AR
- **Sent** — you've delivered it (via email, PDF, or manually)
- **Paid** — customer paid; should never regress
- **Overdue** — past due date
- **Void** — cancelled; preserves the record for audit

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
