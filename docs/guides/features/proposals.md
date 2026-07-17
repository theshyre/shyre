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
- **Line items** — each line item is a *proposed project* with a title, a
  **fixed price**, an optional one-line **"what it does for you"** summary (used
  in the summary table — see below), and a rich **markdown body** (the *Details*
  field). Write
  the scope however reads best — headings, **bold**, bullet lists, even tables
  — with a live preview in the editor. The body renders the same on the detail
  page, the client sign page, and the PDF. (Proposals authored before this had
  separate "why it matters / out of scope / definition of done" fields; those
  still render, and open pre-composed into the markdown body when you edit.)
- **Overview** — an optional proposal-level markdown intro/summary shown above
  the line items (great for a cover note or a summary table).
- **Phases** — a line item can break into named phases with sub-prices. Each
  phase has a **name** (rendered bold), an optional **note** after it, and a
  price — e.g. **Update the visual framework** (Bootstrap 4 → 5) — $2,200. The
  phases must **sum exactly to the item's fixed price** (the editor shows a live
  check), and the item can be marked **capped** so the quote reads as a hard
  ceiling.
- **Terms** — payment terms (net-N presets or custom), an optional deposit
  (percent of the accepted total, or a flat amount — recorded as a term and
  shown on the PDF), a warranty window in days, and free-form additional
  terms.

### Save as you go

A proposal is a **draft** you can build up over time. **Save draft** persists
whatever you have so far — an unnamed proposal, no line items yet, or a phased
item whose phases don't add up yet are all fine to save and come back to. There
is no all-or-nothing gate on saving; the draft shows in your proposals list and
reopens for editing any time.

Completeness is only required when the proposal actually goes out. The detail
page shows a **readiness checklist** next to **Send for sign-off**, and the Send
button stays disabled until the checklist is clear:

- the proposal is **named**,
- it has **at least one line item**, each line item and phase has a **title**
  and a valid price, and any phased item's **phases sum exactly** to its price,
- a **signer contact** is chosen (the sign link + one-time code go to them).

(The send action re-checks the same rules server-side, and a database trigger
enforces the phase-sum rule at the moment a draft is frozen — so a proposal can
never go out with a broken breakdown, even via a direct status change.)

### The summary table

When a proposal has **two or more** line items, an at-a-glance **Summary** table
is generated automatically at the top — `#` / Project / *What it does for you* /
Price, with an **All items** total. It's derived from the line items, so it can
never drift from the prices below. The "what it does" column appears only when
at least one item has a summary line. It renders on the detail page, the client
sign page, the preview, and the PDF.

### Preview what the client sees

**Preview** (on the detail page, next to Download PDF) opens the proposal
rendered exactly as it appears on the client's sign page — brand header, summary
table, line items, terms, and the **Acceptance & Authorization** signature block
that closes the document — but read-only. It's **non-consuming**: unlike the client
opening their real sign link, previewing never flips a sent proposal to
"viewed" or touches any lifecycle state, so you can check your work as many
times as you like. (The PDF download remains the take-away document; the
preview is the on-screen, web-page view.)

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
browser (nothing is uploaded): your team's **uploaded logo** (or, if none is
set, the two-tone wordmark in your brand color), the pricing table with phased
sub-items, terms, and a **two-party signature block** — each line item carries
a physical tick-box so a client signing on paper can mark the subset they
authorize.

## Branding your proposals

**Team settings → Branding** (owner/admin) is where your brand lives:

- A **wordmark** (two-tone text) and a **brand color** — the fallback mark, and
  the accent color used across the document.
- A **logo** — upload a PNG or JPG (up to 2 MB) and it renders in the proposal
  PDF header and at the top of the public sign page the client sees, in place of
  the wordmark. (SVG/WebP uploads show on the sign page but the PDF falls back to
  the wordmark — the PDF engine only embeds PNG/JPG.)

Uploaded logos are stored per-team and are only writable by that team's owners
and admins; see SAL-041 for the storage posture.

### Customer co-branding

A proposal is a document *from* your team *to* a customer, so both sides can
carry identity. On a **customer's** edit page (**Branding**) you can set:

- an **accent color** (hex) — colors the customer's name in the "Prepared for"
  block on the PDF and on the sign page; and
- a **customer logo** — shown next to their name on both surfaces.

When no accent is set, the customer's deterministic chip color is used. Customer
logos live in the same per-team `branding` bucket (under a `customers/` subpath)
with the same owner/admin write rules. Co-branding is internal/client-facing
polish — it never changes the audit record (the frozen `content_sha256` is over
the proposal's terms + line items, not its styling).

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

## Multiple signers

A proposal can require more than one person to sign. On the form, add each
signer under **Signers** (the first is the **primary**). With two or more, pick
a mode:

- **First to authorize** — any one signer's acceptance is binding. Everyone
  gets a link; whoever acts first decides.
- **All must sign** — every signer must authorize the **same** scope. The
  **primary** signs first and selects which line items they accept; that
  selection **binds** the co-signers, who each get their own link, verify their
  own one-time code, and counter-sign the **same** items (shown read-only — a
  co-signer who opens their link before the primary has authorized sees a
  "waiting for the primary" notice and can't sign yet). The proposal only flips
  to **accepted** once everyone has signed; a **decline by anyone** ends it.

Because every signature in "all" mode covers the identical accepted subset,
they all share one frozen `content_sha256` — one coherent audit record, not a
pile of conflicting ones. The detail page shows a **Signers** panel with each
person's status and an "X of N signed" count.

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
