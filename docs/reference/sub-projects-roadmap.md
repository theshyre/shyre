# Sub-projects — roadmap

This is the source of truth for sub-projects work. Phase A and Phase B
are shipped; Phase C is in flight. Anything below the "Deferred" line
is intentionally not in scope yet — when it's time to pick one up, the
rationale and shape are captured here so we don't redesign from
scratch.

## What sub-projects are

A sub-project is a `projects` row whose `parent_project_id` points at
another `projects` row in the same team and (if not internal) the same
customer. The triggers in `supabase/migrations/20260505160000_project_parent_subprojects.sql`
hold the invariants:

- one level deep only — a child cannot itself become a parent;
- a parent's `customer_id` and `is_internal` must match the child's;
- changing a parent's customer is blocked while it has children
  (re-parenting is expand-contract: detach children → move → reattach).

Why one level deep: real consulting engagements rarely nest beyond
"engagement → phases" or "retainer → workstreams." Allowing two-deep
opens up a class of UX questions (how does a chart roll up? how does
the leaf-only picker render?) that we haven't paid for. If a second
real customer asks for it, revisit (see "Deferred — deeper nesting").

## Phase A — schema + parent rollup card (shipped 2026-04-30 · `f498555`)

- `parent_project_id uuid` on `projects`, FK to `projects(id)` on
  delete restrict.
- Two `BEFORE INSERT/UPDATE` triggers enforce depth + customer
  invariants.
- `idx_projects_parent` for child lookup.
- `projects_v` view exposes `parent_project_id`.
- Parent project detail page renders a sub-projects section
  (`src/app/(dashboard)/projects/[id]/sub-projects-section.tsx`)
  with a rolled-up totals card (own + all children, hours and
  dollars) and per-child rows showing burn vs. budget.
- Rollup math extracted to `sub-projects-rollup.ts` with co-located
  tests (added 2026-05-05).

## Phase B — pickers + invoice filter (shipped 2026-05-01 · `4666987`, `9cdbafb`)

- New / edit project forms accept a `parent_project_id` selection.
- Projects list page renders parents with their children indented
  beneath, breadcrumb-linked.
- Time-entry project picker is **leaf-only** — selecting "the
  parent" for a time entry would be ambiguous (it has no work of
  its own once children exist), so the picker hides parents from
  the entry-creation flow.
- New-invoice form's project filter accepts an array of project ids
  via `project_ids[]` and the action consumes it via
  `.in("project_id", ids)`.
- 10 trigger integration tests in
  `src/__integration__/rls/projects-parent-trigger.test.ts`.

## Phase C — rollup filters on time-entries + reports (in flight, 2026-05-05)

The Phase A rollup card answers "what's the total work on this
engagement?" but only on the parent's detail page. A user filtering
`/time-entries` by project, or scoping `/reports` to a project, hits
the same leaf-only picker as the entry form — they can pick "Phase 1"
or "Phase 2" but not "the engagement." This phase fixes that.

**In scope:**

- `expandProjectFilter(projects, selectedId)` — pure helper that, for
  a selected project, returns `[selectedId]` if it's a leaf, or
  `[parentId, ...leafChildIds]` if it's a parent. Used by every
  surface that filters by project.
- `/time-entries` adds a `project` query param + a single-select
  picker that surfaces parents alongside leaves (visually indented
  to mirror the projects list). Selecting a parent rolls up.
- `/reports` adds the same picker so the period totals + group-by
  cards scope to the selected project tree.
- Visible signal when rollup is active — a small "Includes N
  sub-projects" hint next to the picker so the user understands
  why the totals span multiple projects.
- i18n keys for the new strings (en + es).
- Feature doc at `docs/guides/features/sub-project-rollup-filter.md`.

**Out of scope for Phase C** (intentionally — keep the surface
small):

- Multi-select in the time-entries picker. The invoice form
  already does multi-select via a different pattern; if a user
  wants entries from "Phase 1 + Phase 2 only, not Phase 3," the
  current single-select picker doesn't help — but adding multi
  here doubles the surface for a use case nobody has asked for.
- Rolling the picker into the Reports group-by toggle. Today the
  three group-by sections (client / project / member) always
  render; layering rollup on top of them is a separate UX decision.
- Expenses page rollup. The expense filter at
  `business/[id]/expenses/query-filters.ts` uses single-`.eq()` on
  `project_id`. Migrating it to `.in()` is mechanical but expenses
  haven't been called out as a rollup pain point yet.

## Phase D — field inheritance on sub-project creation (shipped 2026-05-05)

When the user picks a parent in the New project form, the inheritable
fields pre-fill from the parent so a new phase doesn't need every
detail re-typed. Each remains editable; once the user types in a
field it's marked touched and a later parent change won't clobber
their value.

**Inherited via form pre-fill** (visible to the user, can override):
`hourly_rate`, `default_billable`, `github_repo`, `invoice_code`,
`category_set_id`, `require_timestamps`. The form shows a
"Filled from parent" hint after the pick so the user knows what
just happened.

**Silently inherited in the server action** (no UI surface today):
`jira_project_key`. If a parent has a Jira key and the form
submission has none, the action fills it before the INSERT.

**Explicitly NOT inherited** — see `src/lib/projects/parent-defaults.ts`
for the full rationale. Highlights: `name` / `description` are
phase-specific; `budget_hours` is a per-phase number, not a default
that should propagate; `customer_id` / `is_internal` are
trigger-enforced to match (not "inherited" — constrained); `status`
is independently lifecycled; `extension_category_set_id` is
project-scoped (one extension set per project) so cloning categories
would be a separate, deliberate action.

**Snapshot, not live.** Pre-fill copies the parent's current values
onto the child as literals at creation time. A later change to the
parent does NOT retroactively propagate to children. The rollup card
on the parent's detail page already does null-fallback for
`hourly_rate` at display time, so a child whose rate is left blank
shows the parent's current rate without a literal copy — that path
is unchanged.

**Not in scope here:** an "Apply parent's settings" action on the
edit form for an existing sub-project. Mostly mechanical to add
when someone wants it; the core feature here is "make the create
flow not painful."

## Deferred — explicitly not in scope

Each of these is a reasonable next phase. If you pick one up, expand
the section here with the implementation plan before writing code.

### Bulk reparenting / move-between-parents UI

**Use case:** "All these entries belong on Phase 2, not Phase 1."
Today the only path is editing each entry's project one at a time
or running a SQL update. The triggers already permit re-parenting
(via `UPDATE projects SET parent_project_id = ...`); what's missing
is a UI that selects N entries (or N child projects) and submits
them as a batch. Pairs with the existing multi-select-tables pattern
on `/time-entries` (see `docs/reference/multi-select-tables.md`).

### Invoice rendering of sub-project hierarchy

**Use case:** "On the invoice, group line items by phase under the
engagement header." Today the invoice line-item template is flat
per project. A two-line rendering (parent name, indented child
name) would be a layout change in `InvoicePDF.tsx` plus a grouping
pass on the line-item array. Marked Phase A "cross-child rollup
defer until second user asks" — that's still where this sits.

### Deeper nesting (3+ levels)

**Use case:** "Engagement → workstream → phase → milestone." Real
consulting hierarchies sometimes go this deep. Today the
`projects_enforce_parent_invariants` trigger blocks any insert
that would create a 3rd level. Lifting it requires:

- a recursive CTE in the rollup SQL (single-level `.in()` no
  longer suffices);
- the picker has to render a tree, not a two-deep list;
- the rollup card on the parent's detail page has to decide
  whether to show grandchildren expanded or collapsed.

This is genuinely more work. Don't ship it speculatively.

### Sub-project templates / cloning

**Use case:** "Spin up next month's phase quickly." Adding a
`Clone phase` action that copies `name`, `budget_hours`,
`hourly_rate`, `category_set_id`, and the parent link — but never
the time entries. Half-day-ish; the right time to do it is when
someone is actively running enough phased engagements to feel the
friction.

### Budget cascade (parent rate overrides children)

**Use case:** "Set the rate on the engagement and have all phases
pick it up." The rollup card already falls back to the parent's
rate when a child has none, but `time_entries.hourly_rate` (the
denormalized snapshot at entry time) is taken from the entry's
`projects.hourly_rate` — not the parent's. To make the cascade
real, the time-entry trigger that snapshots the rate needs to walk
up the parent chain. Fine; not free; not asked for yet.

### Time-entry bulk-reassign by sub-project

**Use case:** "Move these 12 entries from Phase 1 to Phase 2."
Today this requires editing each entry. A bulk select + reassign
fits the existing `/time-entries` overlay-strip pattern. Estimate:
half day. Surface only useful once people are heavily phased; ship
on demand.
