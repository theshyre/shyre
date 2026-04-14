# Solo Consultant

## Role

The primary Shyre user. A single operator billing clients by the hour, generating their own invoices, filing their own taxes. No team, no manager, no IT department.

## What they care about

- **Zero-friction time tracking.** Starting a timer should take 2 seconds. Stopping it, 1 second. Anything slower and they won't do it — which means they'll bill from memory and lose money.
- **Trust in the data.** If they tracked 37.5 hours this week, the report must show 37.5 hours. Rounding, floor/ceil, or sneaky "this week excludes Sunday" framings are fatal.
- **Invoicing in minutes, not hours.** Month-end invoice generation should be: pick customer, confirm hours, send. Every field they have to fill is money the tool is costing them.
- **Data portability.** Their data isn't held hostage. CSV exports of time, customers, invoices. If they decide to leave Shyre, they leave with their history intact.
- **Fair pricing for a solo.** Features gated behind a "Teams" tier when a solo needs them are rage-inducing.
- **Offline / spotty network resilience.** Consultants work on planes and in client offices with weird VPNs.
- **Receipts and categorization that survive tax season.** When their accountant asks for last year's subscription expenses, the answer is one export.

## Review checklist

When reviewing a change, flag:

- [ ] **Adds more than 1 click to the common path?** Starting/stopping a timer, creating a customer, sending an invoice.
- [ ] **Requires filling a field the user doesn't have yet?** (e.g., "tax ID required to save customer" when it isn't legally required to bill.)
- [ ] **Rounds or re-buckets time data without making it obvious?** Hours must add up bit-for-bit.
- [ ] **Locks functionality behind a paid tier that a solo genuinely needs?** If yes, raise it.
- [ ] **Introduces a field that won't survive tax time?** Categories, flags, notes that can't be exported or reported on are dead weight.
- [ ] **Forces a modal where inline would do?** Modals break flow and make bulk work painful.
- [ ] **Breaks on flaky network?** Optimistic UI + clear retry story, or graceful degradation.
- [ ] **Makes the export story worse?** CSVs must stay valid for every feature we add.
- [ ] **Adds a new "onboarding" step before first use?** Solo users just want to start the timer.
