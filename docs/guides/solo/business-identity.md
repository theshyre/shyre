# Business identity

Legal identity for your organization. Used on invoices, for tax filing, and for forms your accountant or state asks for.

## Why this exists

Shyre uses this to put the right legal name, EIN, and address on invoices. It's also a single place to look up "what's our EIN?" or "when was the business incorporated?" without digging through email.

## Where it lives

Sidebar → **Business**. The identity card shows:

- **Legal name** — the formal registered name. Leave blank to fall back to the org's display name.
- **Entity type** — Sole prop, LLC, S-Corp, C-Corp, Partnership, Nonprofit, Other.
- **Tax ID (EIN)** — stored as-entered. Handle with care; don't screenshot.
- **State registration ID** — optional, state-specific.
- **Registered in** — state of formation.
- **Date of incorporation**
- **Fiscal year start** — MM-DD. Defaults to 01-01 (calendar year). `07-01` for July–June fiscal year, etc.

## Editing

Click **Edit** on the Business page → opens `/business/info` → fill in → **Save**. Owners and admins only.

## How it's used

- Invoices populate the "From" block from these fields.
- Reports can scope "this fiscal year" based on `fiscal_year_start`.
- Tax / compliance exports (planned) will key off these fields.

## Privacy

The EIN is sensitive. It's stored in `organization_settings`, which is gated by org-role RLS — only owners and admins can read or write it. There's no endpoint that returns it in a list query.

## Related

- [Expenses](expenses.md) — same page hosts the Expenses tile
- Agency guide to [orgs and roles](../agency/orgs-and-roles.md)
