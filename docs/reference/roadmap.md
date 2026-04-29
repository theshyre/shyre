# Roadmap — planned features

> Living list of features that have been scoped, named by stakeholders, or
> deferred from a current sprint but should not get lost. Not promises, not
> dates — just "we know we want this and here's what we know about it."
>
> Move items OUT of this doc when shipped (link to the feature guide instead)
> or when explicitly dropped (note why).

## Expenses — receipt + email ingestion

**Status:** planned, not yet started (queued behind CSV import landing).

**Goal:** Forward a receipt email or drop an image / PDF receipt into Shyre and have it automatically create a draft expense line item with the right vendor, amount, date, and category — no manual data entry. The user reviews the draft before it lands in `/business/[businessId]/expenses`, so the LLM extraction is a starting point, not the final state.

**Two ingestion modes envisioned:**

1. **Email forwarding.** Each business gets a unique receipts-inbox address (e.g., `receipts+{shortBusinessId}@in.shyre.app`). Users forward vendor confirmation emails (Linode invoice, Adobe subscription receipt, Amazon order confirmation, etc.) to that address. An inbound-email service (Resend, SendGrid, or Postmark) webhooks the message to a Shyre route, which extracts the receipt fields via an LLM and creates a `draft` expense.

2. **Direct upload.** A "Drop a receipt" button on `/business/[businessId]/expenses` accepts an image or PDF. Same extraction pipeline, same draft-then-confirm flow.

**Why drafts matter:** LLM extraction will be wrong some of the time (cropped receipts, foreign-currency formatting, unclear vendor names). A draft state means a confidently-extracted expense is one click to confirm; an ambiguous one is one click to edit before confirming. Without drafts, every false positive lands as a real expense and pollutes tax reports.

**Pieces that need to exist before this can be built:**

- `expenses.status` column with values `draft | confirmed` (or a separate `expense_drafts` table — TBD which is cleaner). Today every row in `expenses` is implicitly confirmed.
- Inbound email service contract — pick a provider, set up MX/DNS, wire the webhook.
- File storage for original receipt images (Supabase Storage bucket, RLS-scoped per business).
- Vendor/amount/date extraction prompt + LLM call wrapped in `lib/extract-receipt.ts`.
- A `/business/[businessId]/expenses/drafts` review surface — a queue of pending drafts with confidence indicators per field.
- Idempotency on email ingestion: dedupe by message-id so forwarding the same email twice doesn't create two drafts.

**Open questions for when this gets prioritized:**

- Per-user vs. per-business inbox addresses? Per-business is simpler operationally; per-user lets you forward a personal receipt for reimbursement without it landing in the wrong business.
- Currency / conversion: a foreign-currency receipt — store native + converted, or only converted? Affects bookkeeper exports.
- Privacy: receipts often have credit card last-4, addresses, customer-ID numbers. Storing the original image creates a long-lived data-handling obligation. Worth confirming with security review before storage goes live.
- Cost: per-receipt LLM cost is small ($0.01-ish) but a heavy user could forward thousands a year. Caps + alerting needed.

**Why it's queued, not in flight:** the manual CSV importer covers historical data (the once-per-business onboarding case). Receipt ingestion solves the ongoing, day-to-day expense capture — the higher-value but lower-urgency surface. Ship CSV first, then revisit this with real onboarding data in hand to inform the LLM prompt and the drafts UX.

---

_(Add new entries above this line, newest at top within each section.)_
