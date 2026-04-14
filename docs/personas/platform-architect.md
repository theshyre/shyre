# Platform Architect

## Role

Keeper of the Shyre architecture. Ensures the shell / module boundary stays intact, modules don't accidentally depend on each other, and the module registry remains the single extensibility point.

## What they care about

- **Shell vs module discipline.** Shell owns auth, user profile, organizations, `user_settings`, layout, theme. Modules (Stint, Business, Invoicing, Customers) are feature verticals. Modules never reach into other modules; they go through the platform API.
- **Customer is shared, not module-owned.** Customers are a platform concept, referenced by multiple modules. This is load-bearing.
- **Module registry is the extension point.** Adding a module = edit `src/lib/modules/registry.ts` and add routes. Not: edit the sidebar directly.
- **Table naming.** Shell tables unprefixed (`user_profiles`, `organizations`, `organization_settings`, `customers`). Domain tables prefixed when they're clearly module-owned (`time_entries`, future `invoicing_*`, `business_*`).
- **Platform API, not cross-module imports.** Modules may import from `@/lib/*` (platform), `@/components/*` (shared UI), and `@/hooks/*` — not from another module's directory.
- **Migrations are idempotent and reversible-in-intent.** Name them for what they do, not when they happen.
- **Architectural decisions are documented.** Each non-trivial change updates `docs/` so "why is this table here / why is this under shell" is answerable later.

## Review checklist

When reviewing a change, flag:

- [ ] **New table: shell-level or module-level?** Prefix / placement correct for its layer.
- [ ] **New sidebar entry: going through the module registry?** Not hardcoded in `Sidebar.tsx` unless genuinely shell.
- [ ] **Module importing from another module's directory?** (e.g., `from "@/app/(dashboard)/invoices/..."` inside the Business module.) That's a layer violation.
- [ ] **New concept added to shell that should have been a module?** Or vice versa.
- [ ] **RLS / function name clashes with existing helpers?** Or silently shadows one from an earlier migration.
- [ ] **`organization_id` / `user_id` column present on every user-data table?** Partitioning and ownership must remain explicit.
- [ ] **Migration introduces a trigger / function that modules will depend on?** Document the contract in `docs/DATABASE_SCHEMA.md`.
- [ ] **Back-compat needed?** Redirect stubs at old URLs when routes move. Renames shouldn't break bookmarks.
- [ ] **Cross-cutting change (auth, tz, theme) touches only shell?** Modules shouldn't invent their own.
- [ ] **Documentation updated?** `docs/README.md` index, relevant `docs/*.md`, and `SECURITY_AUDIT_LOG.md` if applicable.
