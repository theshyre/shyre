# People

Everyone the business employs, contracts, or otherwise tracks on the payroll / vendor ledger. Employees, contractors, partners, owners — one list, grouped by employment type.

## Why this exists

Running a consulting business means knowing who you pay. W-2 employees, 1099 contractors, silent partners, you on a salary — they all need to show up somewhere that maps cleanly to the questions a bookkeeper asks at tax time ("who do we W-2?", "who do we 1099?"). The People tab is that list.

A person may or may not be a Shyre user. A W-2 employee who tracks time in Shyre is a linked record. A 1099 contractor who just sends invoices and gets paid is unlinked — no login, no friction. Both show up in the same People list, distinguished by `employment_type`.

## Where it lives

Sidebar → **Business** → pick one → **People** tab.

People are grouped into three sections:

- **Partners & Owners** — equity-holders, sole proprietors taking owner draws. K-1 or owner-distribution territory, not 1099.
- **Employees** — W-2. Salary or hourly. Payroll reconciles against these.
- **Contractors** — 1099. Year-end 1099-NEC filtered to this group.

A fourth "Other" section appears if you have anyone marked `unpaid` (interns, volunteers, advisors-without-cash-comp).

## Adding a person

Click **Add person** → inline form appears.

Required: **Legal name** + **Employment type**. Everything else is optional.

Useful:
- **Preferred name** — override for UI display if different from the legal name. "Robert Smith" on the W-2, "Bob" in Shyre's avatar.
- **Linked Shyre user** — optional dropdown of users already in the business's teams. Linking does NOT grant access (team membership still gates that) — it just associates the person with their login so their avatar shows up on the People list.
- **Work email / phone** — payroll/HR contact. Distinct from login email.
- **Title / Department / Employee number** — freeform.
- **Started on / Ended on** — employment dates.
- **Compensation** — `type` (salary / hourly / project_based / equity_only / unpaid) + `amount` + `currency` + `schedule` (annual / monthly / biweekly / weekly / per_hour / per_project). Amount is entered in dollars with 2-decimal precision; stored as integer cents.
- **Mailing address** — needed for 1099s at year-end.
- **Reports to** — optional self-reference to build a simple org chart.

## Permissions

Owner or admin of any team in the business can add, edit, or delete people. Regular members can view the list but not modify.

## Legal name vs Shyre display name — why both exist

This is the most common "why is this duplicated?" question. They're different fields for different purposes:

- `user_profiles.display_name` — what shows on your Shyre avatar. You chose it. "Bob."
- `business_people.legal_name` — what goes on tax forms. The IRS chose the format. "Robert A. Smith."

These aren't derivable from each other. Deriving `legal_name` from `display_name` produces bad W-2s and 1099s. Both exist because they answer different questions.

## Limits of v1

The following are deliberately deferred to a future PR — they touch sensitive compliance fields that need encryption-at-rest decisions:

- TIN / SSN / EIN storage
- W-9 on file (+ received date)
- Withholding allowances
- Pay schedule enforcement
- Direct payroll integration

Also deferred:
- Compensation history (changes over time)
- Benefits, PTO, performance reviews
- Invite-new-person-to-Shyre-in-one-step flow (for now, invite them via the Teams page, then link the resulting user to their People record)

## How it maps to the data

Data lives in `public.business_people`. `business_id` is required; `user_id` is optional (nullable FK to `auth.users`). When `user_id` is set, avatar and login email come from `user_profiles` / `auth.users` via join — no duplication. When null, the row stands alone.

Authorization is derived via `user_business_role(business_id)` — same as identity and state registrations. Linking a person to a user does NOT grant that user access to the business; access is strictly via `team_members`.

See [Database schema](../../reference/database-schema.md#business_people) for the full column list.

## Related

- [Business identity](business-identity.md)
- [State registrations](state-registrations.md)
