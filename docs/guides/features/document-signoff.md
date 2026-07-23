# Document sign-off

Send any document — release notes, a statement of work, a validation protocol —
to a set of signatories for a **typed, email-verified electronic signature**, and
keep an **immutable, content-hashed signed record**. It's the same signing
machinery as [proposal sign-off](proposals.md), generalized to arbitrary
documents (proposals stay on their own flow).

Sign-offs live under **Sign-offs** in the sidebar (`/signoffs`). Creating and
sending is owner/admin-only; any team member can view a team's sign-offs.

## Author a sign-off

1. **Sign-offs → New sign-off** (or press `N`).
2. Give it a **title** and **version** (e.g. `Release Notes v2.0.2`), optionally
   pick the **customer** it's for.
3. Paste the document as **Markdown** into the body. It renders on the signer's
   page as formatted Markdown — raw HTML is deliberately **not** rendered, so a
   pasted document can't smuggle a script onto the login-free page.
4. Add the **signatories** — name, email, and optionally a role and organization.
   Signatories are free-form (they can span your team, the client, and a
   sponsor); they don't have to be existing customer contacts.
5. Choose the **signing mode**: *every signatory must sign* (the default) or
   *any one signatory binds*.
6. **Create draft.** You can edit a draft freely — content and roster are frozen
   only once you send.

## Send it

On the sign-off's page, once it's send-ready (title + body + ≥1 signatory), click
**Send for signature**. Each signatory is emailed a **private link**. The
sign-off flips to **Sent**; its roster and content are now locked (a change means
a new sign-off).

## What the signatory sees

1. They open their link and **verify their identity** with a one-time code
   emailed to them (a forwarded link can't be used — the code + a per-browser
   session are required to even view the document).
2. They read the rendered document, type their **name**, **title**, pick what
   they're signing as (**author / reviewer / approver**), tick the
   **attestation**, and **Sign** — or **Decline**.

## The signed record

Each signature is an **immutable record**: the signer's typed name, title, the
meaning of their signature, the time, their IP, and a **SHA-256 hash of the exact
document** they signed. Nothing — not even an admin — can edit an acceptance
row. The sign-off's page shows each signer's status and the content hash. When
every required signatory has signed, the sign-off flips to **Completed**; a
decline ends it.

You can **Cancel** an in-flight sign-off (revokes the outstanding links) before
it completes.

## Regulatory grade

This is a defensible, audit-ready electronic signature (unique link + email OTP,
IP/UA capture, content-hash record linking, an append-only audit trail, and the
signature-meaning + attestation). For clinical software that needs full **21 CFR
Part 11** grade, the remaining gap is tracked in
[`docs/reference/signoff-part11-gaps.md`](../../reference/signoff-part11-gaps.md)
— mainly a printed signed-record artifact and a signature-certification policy.
