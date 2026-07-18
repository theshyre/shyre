# Modules — Shyre platform architecture

Shyre is a platform for running a consulting business. Stint is one module; Business is another; Invoicing is another. All live in a single Next.js app with module-aware structure.

## Shell vs modules

**Shell** (platform-level): auth, user profile, teams, `user_settings`, layout, theme. Shell code lives under `src/app/(dashboard)/` at the top level (`profile/`, `settings/`, `teams/`) plus `src/lib/` helpers. Modules never reach into other modules; they go through the platform API.

**Modules** (feature verticals): siblings of each other.
- **Stint** — time tracking (`time-entries/`, `categories/`, `templates/`, `reports/` — time-related portions)
- **Business** — `/business`, `/business/expenses`, business identity, expenses, future people module
- **Customers** — `/customers`, customer unification across modules
- **Invoicing** — `/invoices`, `/invoices/new`, `/invoices/[id]`

## Module registry

`src/lib/modules/registry.ts` holds a manifest per module. Sidebar renders by merging each module's nav items into shell sections (`track` / `manage` / `setup`).

Add a module:
1. Edit `src/lib/modules/registry.ts` — append a manifest entry.
2. Add module-owned routes under `src/app/(dashboard)/`.
3. Add i18n namespace if the module has its own strings.

Don't hardcode new items into `Sidebar.tsx` or `GlobalCommandPalette.tsx`; go through the registry.

## Shell surfaces — not everything with a nav entry is a module

Always-on platform pages are **shell surfaces**, declared in the registry's `SHELL_SURFACES` export — a parallel list to `MODULES`, same navItem shape, plus a `placement`:

| Surface | Route | Placement | Meaning |
|---|---|---|---|
| Dashboard | `/` | `home` | Head of the sidebar Work section + first palette entry |
| Teams | `/teams` | `setup` | Merged into the Setup nav section after the modules |
| Settings | `/settings` | `setup` | Same |
| Profile | `/profile` | `identity` | Profile-popover / palette tail cluster |
| Docs | `/docs` | `identity` | Same |
| System hub | `/system` | `system` | Sysadmin-only group (`requiresSystemAdmin: true`) |

Why the distinction matters: shell surfaces can't be toggled off and own no vertical domain. Registering them as `ModuleManifest`s (as `/teams` and `/settings` once were) dilutes what "module" means — the registry would degrade into "anything with a sidebar entry." Consumers (`Sidebar.tsx`, `GlobalCommandPalette.tsx`) derive shell entries via `shellSurfacesForPlacement()` / `navItemsForSection()` (which merges modules → shell surfaces → platform tools per section); the breadcrumb registry test enforces trail parity for every declared destination. The `requiresSystemAdmin` flag is declarative — callers supply the viewer's admin bit; per-request data (like the unresolved-errors badge) stays with the caller.

There are three registry lists, one per kind:

- **`MODULES`** — feature verticals (Stint, Invoicing, …). Own tables, own routes, meaningfully toggleable.
- **`SHELL_SURFACES`** — always-on platform pages (table above).
- **`PLATFORM_TOOLS`** — cross-cutting verticals like Import that write into several modules' tables.

## Platform API modules can use

- `getUserContext()`, `getUserTeams()`, `validateTeamAccess()` (from `@/lib/team-context`)
- `createClient()` from `@/lib/supabase/{server,client}`
- `runSafeAction`, `assertSupabaseOk` (from `@/lib/safe-action`, `@/lib/errors`)
- Shared UI: `<Avatar>`, `<TeamSelector>`, `<TeamFilter>`, `<SubmitButton>`, form style classes

## What modules must not do

- Import from another module's directory. (`@/app/(dashboard)/invoices/...` inside `business/` is a layer violation.)
- Invent their own auth, org, or theme logic.

## Shared components must be module-agnostic

The reverse layering rule: nothing under `src/components/` may import module code. Module-specific components live in the module's route directory (e.g. `time-entries/ticket-chip.tsx`, `time-entries/sidebar-timer.tsx`). When shell chrome needs to render a module-owned widget — the sidebar's running timer — the shell component exposes a slot prop (`Sidebar`'s `timerSlot`) and the dashboard layout (the composition root) injects the module component. The layout composing modules is fine; `src/components/` importing them is not.

## Naming rules

- Shell tables: unprefixed. `user_profiles`, `teams`, `team_settings`, `customers`.
- Module tables: prefixed when clearly module-owned. `time_entries`, `time_templates`, future `invoicing_*`, future `business_expenses_*` if Business grows.
- Every user-data table must have `user_id` and `team_id` columns. Ownership + partitioning always explicit.

## Customer is platform-level

Customers are referenced by Time, Invoicing, and Business. They don't belong to any one module. This is load-bearing — don't move `customers` into a module directory or table-prefix it.

## Current modules

| Module | Label (i18n key) | Section | Nav entries |
|---|---|---|---|
| Stint | `modules.stint` | track | Time |
| Customers | `modules.customers` | manage | Customers |
| Projects | `modules.projects` | manage | Projects |
| Invoicing | `modules.invoicing` | manage | Invoices |
| Proposals | `modules.proposals` | manage | Proposals |
| Reports | `modules.reports` | manage | Reports |
| Business | `modules.business` | setup | Business |

Teams and Settings render in the Setup section too, but as shell surfaces (see above), not modules. See `src/lib/modules/registry.ts` for the source of truth.

## Deferred / not-now

- **Monorepo split** — only when a concrete second consumer of shell code appears.
- **Plugin runtime** — only if Shyre becomes a commercial extensibility platform.
- **Separate deploys per module** — not planned.

## Related

- [Architecture](architecture.md)
- [Database schema](database-schema.md)
- Platform Architect persona at `docs/personas/platform-architect.md`


## Documented exception: projects ↔ business expenses

`src/app/(dashboard)/projects/[id]/*` deliberately imports `ExpenseRow`,
`NewExpenseForm`, `dedupeVendors`, and the expense search helpers from
`src/app/(dashboard)/business/[businessId]/expenses/*`. This crosses the
"modules never import from other modules" rule ON PURPOSE (2026-05-28
decision): the project page embeds the real expense surface rather than a
diverging copy. Do not "fix" it by duplicating; the sanctioned refactor is
lifting the shared expense primitives into `src/lib/expenses/` when next
touched.
