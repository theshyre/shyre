# Proposals

Proposals are the front of Shyre's funnel: draft a fixed-price quote, send it
for sign-off, and convert the accepted work into projects that time is tracked
against and billed from. The full loop is live: authoring, the branded PDF,
sending, the public client sign-off, **convert-to-project, and fixed-price
billing**.

## Who can use it

Proposals are commercial documents, so they sit at the same permission tier as
invoices: **team owners and admins** author, edit, and view them. Members
don't see the module's data.

## Drafting a proposal

**Proposals → New proposal** (or press `N` on the list). A proposal has:

- **Header** — customer, optional signer (a contact on that customer), title,
  issued date, and a validity window ("valid until").
- **Line items** — each line item is a *proposed project* with a title,
  plain-language description, "why it matters," optional out-of-scope notes,
  a definition of done, and a **fixed price**.
- **Phases** — a line item can break into named phases with sub-prices. The
  phases must **sum exactly to the item's fixed price** (the editor shows a
  live check), and the item can be marked **capped** so the quote reads as a
  hard ceiling.
- **Terms** — payment terms (net-N presets or custom), an optional deposit
  (percent of the accepted total, or a flat amount — recorded as a term and
  shown on the PDF), a warranty window in days, and free-form additional
  terms.

### The client picks a subset

Clients aren't locked into all-or-nothing: they can authorize **any
combination** of the line items, and the accepted total is computed from what
they select. The editor's **client selection preview** lets you toggle items
to see what any subset would total before you send.

## Numbering

Each proposal gets a per-team number like `PROP-2026-001`, driven by
`proposal_prefix` / `proposal_next_num` in team settings — the same scheme as
invoice numbering.

## The PDF

**Download PDF** on the detail page renders a branded document in your
browser (nothing is uploaded): your team's wordmark and brand color, the
pricing table with phased sub-items, terms, and a **two-party signature
block** — each line item carries a physical tick-box so a client signing on
paper can mark the subset they authorize.

## Sending & the sign-off link

**Send for sign-off** (draft, signer contact required) emails the signer a
private link to a public signing page — no Shyre account needed. Sending
freezes the proposal (`draft → sent`): content can no longer be edited, and
revisions become a new version.

On the signing page the client:

1. Reviews the full document (items, phases, terms, prices).
2. Requests a **one-time code**, emailed to them, and enters it — this proves
   they control the signer's inbox at the moment of acceptance (5 attempts,
   10-minute expiry, re-sendable after a minute).
3. **Checks the line items they authorize** — any combination; the accepted
   total updates live.
4. Types their name, title, and signature, then **Accepts** (or declines).

The link expires after 30 days, works once (a recorded decision consumes it),
and requires `NEXT_PUBLIC_APP_URL` to be configured.

## The acceptance record

Every decision is stored immutably: signer name / title / typed signature,
the exact selected items, the server-computed accepted total, IP address and
browser, the OTP verification time, and a **SHA-256 fingerprint of the full
document as decided on** — the defensible "what exactly was accepted" anchor
for regulated clients. You **counter-sign** accepted proposals from the
detail page, putting both parties on the record. The detail page also shows
the full activity trail (sent, viewed, code verified, accepted, …).

## Lifecycle

`draft → sent → viewed → accepted / declined → converted`, with `superseded`
for replaced versions. Only drafts can be edited or deleted (a draft delete
asks for inline confirmation) — sent and signed proposals are part of the
audit record, are content-frozen at the database level, and are never
deletable.

## Converting accepted work into projects

On an accepted proposal, **Convert to projects** creates one project per
accepted line item — a phased item becomes a project with its phases as
**sub-projects** — owned by the proposal's customer, ready for time tracking.
Each line item links to its created project ("View project"), and the
proposal moves to `converted`. Items the client didn't select are not
converted.

## Billing the fixed price

**Create invoice** (accepted or converted) drafts an invoice with one
fixed-price line per accepted item (`PROP-2026-001 — Basic dependency
upgrades … $950.00`), carrying the proposal's payment terms into the due
date, its currency, and a structured link back to the proposal (so the bill
reconciles to its sign-off without parsing the line text). The tax rate is
the one **frozen when the client signed** — if you change your team default
between sign-off and billing, the signed deal still bills at the rate the
client agreed to. Billed items are locked against double-billing — the button
disappears once everything accepted has been invoiced, and two simultaneous
"Create invoice" clicks can't both bill the same item. The invoice is a normal
draft: review it and send it through the standard invoice flow. Example: a
client accepts Projects 1 + 3 ($950 + $4,000) → one draft invoice totaling
**$4,950**.

**Voiding or deleting** that invoice releases the lock — the fixed-price work
becomes billable again, so a mistaken bill is fully recoverable (correct it by
voiding, then re-billing). Nothing stays stranded as "invoiced" against an
invoice that no longer exists.

## Versions

A sent proposal's content is frozen — revisions go through **New version**
(available on sent, viewed, and declined proposals): the document is copied
into a fresh editable draft with a new number and a bumped version (`v2`,
`v3`, …), linked both ways ("Supersedes" / "Superseded by" on the detail
page). The old sent/viewed proposal flips to `superseded` and **its
outstanding sign links stop working immediately**; a declined proposal keeps
its own record and just gains the link. Accepted or converted proposals are
never superseded — follow-on work is a new proposal.

## Validity windows

`Valid until` is enforced: once the date passes, the signing page shows an
expiry notice and **acceptance is blocked** (server-side too) — though the
client can still record a decline. Issue a new version to re-offer with a
fresh window.
