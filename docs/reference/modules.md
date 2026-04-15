# Modules — Shyre platform architecture

Shyre is a platform for running a consulting business. Stint is one module; Business is another; Invoicing is another. All live in a single Next.js app with module-aware structure.

## Shell vs modules

**Shell** (platform-level): auth, user profile, organizations, `user_settings`, layout, theme. Shell code lives under `src/app/(dashboard)/` at the top level (`profile/`, `settings/`, `organizations/`) plus `src/lib/` helpers. Modules never reach into other modules; they go through the platform API.

**Modules** (feature verticals): siblings of each other.
- **Stint** — time tracking (`time-entries/`, `categories/`, `templates/`, `reports/` — time-related portions)
- **Business** — `/business`, `/business/expenses`, business identity, expenses, future people module
- **Customers** — `/customers`, customer unification across modules
- **Invoicing** — `/invoices`, `/invoices/new`, `/invoices/[id]`

## Module registry

`src/lib/modules/registry.ts` holds a manifest per module. Sidebar renders by merging each module's nav items into shell sections (`track` / `manage` / `admin`).

Add a module:
1. Edit `src/lib/modules/registry.ts` — append a manifest entry.
2. Add module-owned routes under `src/app/(dashboard)/`.
3. Add i18n namespace if the module has its own strings.

Don't hardcode new items into `Sidebar.tsx`; go through the registry.

## Platform API modules can use

- `getUserContext()`, `getUserOrgs()`, `validateOrgAccess()` (from `@/lib/org-context`)
- `createClient()` from `@/lib/supabase/{server,client}`
- `runSafeAction`, `assertSupabaseOk` (from `@/lib/safe-action`, `@/lib/errors`)
- Shared UI: `<Avatar>`, `<OrgSelector>`, `<OrgFilter>`, `<SubmitButton>`, form style classes

## What modules must not do

- Import from another module's directory. (`@/app/(dashboard)/invoices/...` inside `business/` is a layer violation.)
- Invent their own auth, org, or theme logic.

## Naming rules

- Shell tables: unprefixed. `user_profiles`, `organizations`, `organization_settings`, `customers`.
- Module tables: prefixed when clearly module-owned. `time_entries`, `time_templates`, future `invoicing_*`, future `business_expenses_*` if Business grows.
- Every user-data table must have `user_id` and `organization_id` columns. Ownership + partitioning always explicit.

## Customer is platform-level

Customers are referenced by Time, Invoicing, and Business. They don't belong to any one module. This is load-bearing — don't move `customers` into a module directory or table-prefix it.

## Current modules

| Module | Label (i18n key) | Section | Nav entries |
|---|---|---|---|
| Stint | `modules.stint` | track | Time |
| Customers | `modules.customers` | manage | Customers |
| Invoicing | `modules.invoicing` | manage | Invoices |
| Business | `modules.business` | admin | Business |

See `src/lib/modules/registry.ts` for the source of truth.

## Deferred / not-now

- **Monorepo split** — only when a concrete second consumer of shell code appears.
- **Plugin runtime** — only if Shyre becomes a commercial extensibility platform.
- **Separate deploys per module** — not planned.

## Related

- [Architecture](architecture.md)
- [Database schema](database-schema.md)
- Platform Architect persona at `docs/personas/platform-architect.md`
