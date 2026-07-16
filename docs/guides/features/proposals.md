# Proposals

Proposals are the front of Shyre's funnel: draft a fixed-price quote, send it
for sign-off, and convert the accepted work into projects that time is tracked
against and billed from. **Phase 1 (current)** covers authoring and the
branded PDF; sending, in-app client sign-off, and convert-to-project arrive in
the next phases.

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

## Lifecycle

`draft → sent → viewed → accepted / declined → converted`, with `superseded`
for replaced versions. In Phase 1 proposals stay in `draft`; only drafts can
be edited or deleted (a draft delete asks for inline confirmation — sent and
signed proposals will be part of the audit record and are never deletable).

## What's next (later phases)

- **Send** via the existing email pipeline, and a public, login-free signing
  link with a one-time email code.
- **Acceptance records** — who authorized which items, when, from where,
  against which exact document version.
- **Convert** accepted items into projects (phased items become a project
  with sub-projects) and bill the fixed price straight onto an invoice.
