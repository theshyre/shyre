# Proposals

Proposals are the front of Shyre's funnel: draft a fixed-price quote, send it
for sign-off, and convert the accepted work into projects that time is tracked
against and billed from. Authoring, the branded PDF, **sending, and the
public client sign-off** are live; convert-to-project and fixed-price billing
arrive next.

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

## What's next (later phases)

- **Convert** accepted items into projects (phased items become a project
  with sub-projects) and bill the fixed price straight onto an invoice.
- **Versioning** — revise a sent proposal by issuing a new version that
  supersedes the old one.
