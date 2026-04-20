# Business identity

Legal identity for your business. Used on invoices, for tax filing, and for forms your accountant or state asks for.

## Why this exists

Shyre uses this to put the right legal name, EIN, and address on invoices. It's also a single place to look up "what's our EIN?" or "when was the business incorporated?" without digging through email.

Starting in the business/team split, **a business is a first-class entity that owns one or more teams**. Legal identity lives on the business, not the team — so two teams sharing one LLC don't have to duplicate or reconcile EINs and state registrations.

## Where it lives

Sidebar → **Business** → pick one → **Identity** tab.

The identity card shows:

- **Legal name** — the formal registered name. Leave blank to fall back to the business's display name.
- **Entity type** — Sole prop, LLC, S-Corp, C-Corp, Partnership, Nonprofit, Other.
- **Tax ID (EIN)** — stored as-entered. Handle with care; don't screenshot.
- **State registration ID** — optional, state-specific.
- **Registered in** — display of the formation state (canonical value lives on state registrations; see below).
- **Date of incorporation**
- **Fiscal year start** — MM-DD. Defaults to 01-01 (calendar year). `07-01` for July–June fiscal year, etc.

Below the identity card, the **State registrations** section lists every state where the business is formed or foreign-qualified. See [State registrations](state-registrations.md).

## Editing

Click a field → edit → **Save business identity**. Owners and admins only (role is derived: owner/admin of any team owned by this business).

## How it's used

- Invoices populate the "From" block from these fields.
- The issuing invoice snapshots the business_id at creation time — re-parenting the team later does not rewrite old invoices.
- Reports can scope "this fiscal year" based on `fiscal_year_start`.
- Tax / compliance exports (planned) will key off these fields.

## Privacy

The EIN is sensitive. It lives in the `businesses` table, gated by team-role-derived RLS — only owners and admins of a team in the business can read or write it. There's no endpoint that returns it in a list query.

## Related

- [State registrations](state-registrations.md) — multi-state formation + foreign qualifications
- [Expenses](expenses.md) — same surface hosts the Expenses tab
- Agency guide to [orgs and roles](../agency/teams-and-roles.md)
