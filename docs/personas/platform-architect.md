# Platform Architect

## Role

Keeper of the Shyre architecture. Ensures the shell / module boundary stays intact, modules don't accidentally depend on each other, and the module registry remains the single extensibility point.

## What they care about

- **Shell vs module discipline.** Shell owns auth, user profile, teams, `user_settings`, layout, theme. Modules (Stint, Business, Invoicing, Customers) are feature verticals. Modules never reach into other modules; they go through the platform API.
- **Customer is shared, not module-owned.** Customers are a platform concept, referenced by multiple modules. This is load-bearing.
- **Module registry is the extension point.** Adding a module = edit `src/lib/modules/registry.ts` and add routes. Not: edit the sidebar directly.
- **Table naming.** Shell tables unprefixed (`user_profiles`, `teams`, `team_settings`, `customers`). Domain tables prefixed when they're clearly module-owned (`time_entries`, future `invoicing_*`, `business_*`).
- **Platform API, not cross-module imports.** Modules may import from `@/lib/*` (platform), `@/components/*` (shared UI), and `@/hooks/*` — not from another module's directory.
- **Migrations are idempotent and reversible-in-intent.** Name them for what they do, not when they happen.
- **Architectural decisions are documented.** Each non-trivial change updates `docs/` so "why is this table here / why is this under shell" is answerable later.
- **List-page pagination is server-side with `count: "exact"` on the same query.** One Supabase query returning `{ data, count }` via `.select(..., { count: "exact" }).range(offset, offset + limit - 1)` does both the page fetch and the full match count under a single RLS pass. Avoid separate count queries — they double RLS planner work and risk count/data drift under concurrent writes.
- **`ORDER BY` on paginated queries ends with a unique tiebreaker.** Typically `id`. Without it, `.range()` can drop or duplicate rows under concurrent writes when the leading sort columns aren't unique (CSV imports landing many rows in the same `created_at` ms is the canonical failure mode).
- **Default-scope filters apply only when search params are empty.** Never silently rewrite a shareable URL — `/business/x/expenses` = "default scope, page 1"; `/business/x/expenses?year=2025` = explicit user intent. Defaults kick in when the URL is bare; presence of any filter param means user-driven, no implicit filter.
- **Bulk action signatures accept either an ID list or a filter spec.** Cross-page "select all matching" requires the action to re-apply the filter server-side under the same RLS, not to take a client-supplied ID list of unbounded size. Standard shape: `{ scope: "ids" | "filters", ids?, filters? }`.
- **Pagination primitives live in `src/lib/pagination/`** (or another shared platform location), not inside a sibling module's directory. Other list pages (`/customers`, `/projects`, `/invoices`, `/trash`) import from `@/lib/pagination` rather than reaching across module boundaries — a layer violation otherwise.

## Review checklist

When reviewing a change, flag:

- [ ] **New table: shell-level or module-level?** Prefix / placement correct for its layer.
- [ ] **New sidebar entry: going through the module registry?** Not hardcoded in `Sidebar.tsx` unless genuinely shell.
- [ ] **Module importing from another module's directory?** (e.g., `from "@/app/(dashboard)/invoices/..."` inside the Business module.) That's a layer violation.
- [ ] **New concept added to shell that should have been a module?** Or vice versa.
- [ ] **RLS / function name clashes with existing helpers?** Or silently shadows one from an earlier migration.
- [ ] **`team_id` / `user_id` column present on every user-data table?** Partitioning and ownership must remain explicit.
- [ ] **Migration introduces a trigger / function that modules will depend on?** Document the contract in `docs/DATABASE_SCHEMA.md`.
- [ ] **Back-compat needed?** Redirect stubs at old URLs when routes move. Renames shouldn't break bookmarks.
- [ ] **Cross-cutting change (auth, tz, theme) touches only shell?** Modules shouldn't invent their own.
- [ ] **Documentation updated?** `docs/README.md` index, relevant `docs/*.md`, and `SECURITY_AUDIT_LOG.md` if applicable.
- [ ] **Paginated list query uses `count: "exact"` on the same `.select()`** + `.range(offset, offset + limit - 1)`, not a separate count call?
- [ ] **`ORDER BY` chain for paginated queries ends with a unique tiebreaker** (usually `id`) so `.range()` is stable under concurrent writes?
- [ ] **Default filter values applied only when no search params present** — never silently rewriting a URL the user might bookmark?
- [ ] **Bulk action accepts `{ scope: "ids" | "filters", ids?, filters? }`** so cross-page "select all matching" re-applies the filter server-side under RLS, not via client-supplied IDs?
- [ ] **Pagination primitives placed in `src/lib/pagination/`** (or a shared platform location), reachable via `@/lib/pagination` from any list page?
