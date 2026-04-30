# Agency Owner

## Role

Runs a 3–10 person consulting or dev shop. Bills clients by the hour, but staff members enter their own time and the owner reviews / invoices. Multiple teams, multiple roles, multiple overlapping customers.

## What they care about

- **Team visibility without surveillance.** They need "who billed what this week" rollups, not keystroke logs.
- **Role-appropriate access.** Contributors see their entries + their team's aggregates. Admins/owners see everything. A junior contractor should never accidentally see another client's rates.
- **Customer sharing across teams.** When they subcontract, the subcontracting firm should see *that* customer's time without seeing everything else.
- **Bulk actions.** Invoicing 8 customers on the 1st of the month is a spreadsheet exercise without bulk.
- **Audit and dispute resolution.** When a customer disputes hours, the owner needs the paper trail: who logged what, when, and any edits.
- **Onboarding a new team member should take one sitting.** Invite, role, team, maybe a security group. Not a day of setup.
- **Permissions must fail closed.** If an RLS check goes wrong, default to deny and surface the error. Never silently show more than intended.
- **Bulk-action scope under pagination is an audit-trail concern.** When a list page paginates, "select all" must distinguish between the visible page and the full filter set. Silent ambiguity is dangerous: a "bulk recategorize Software → SaaS" that quietly affects only page 1 of 7 leaves pages 2-7 in the wrong P&L bucket without anyone noticing. Same risk on bulk delete, bulk approve, bulk lock-period. Surface the choice as a Gmail-style two-step (master checkbox = page; banner CTA "Select all N matching" promotes to filter set), and write the audit-log entry with the filter snapshot rather than 312 individual rows.

## Review checklist

When reviewing a change, flag:

- [ ] **Does this action respect role?** Contributor / admin / owner distinctions clear, enforced server-side, tested.
- [ ] **Does it scale to N users in an team?** Rendering the user picker? N^2 queries? N members in a dropdown?
- [ ] **Cross-team leakage risk?** Any query that filters by team must actually filter by team — verified, not assumed.
- [ ] **Does a contributor see only what they should?** Rates, customer notes, other users' entries — list them out.
- [ ] **Bulk operations present for repetitive admin work?** Month-end invoice run, period-close, period reopen.
- [ ] **Edit history / audit trail preserved?** Time entry changes, invoice edits, customer changes — who did what when.
- [ ] **Does onboarding a new member work end-to-end in one flow?** Don't make the owner click through six settings pages.
- [ ] **Security group and customer share mechanics still sound?** Adding a new feature shouldn't implicitly widen share scope.
- [ ] **"Select all" UX explicit about scope on paginated tables?** Page-only and all-matching surfaced as two distinct affordances (Gmail pattern), never silently one-or-the-other?
- [ ] **Bulk action on filtered + paginated list re-applies the filter server-side**, with the audit-log entry referencing the filter snapshot rather than an unbounded ID list?
