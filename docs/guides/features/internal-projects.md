# Internal projects

A first-class concept for "your own work" — the things you log time on but never invoice. Examples: your own product, R&D, ops, internal tooling. Liv and Shyre under Marcus's account are the canonical case.

## What an internal project is

A project marked `is_internal = true`:

- **Has no customer.** The CHECK constraint `projects_internal_xor_customer` makes this an invariant, not a convention: internal projects always have `customer_id IS NULL`, and non-internal projects always have a customer.
- **Defaults all new time entries to non-billable.** Server actions force `billable = false` on entries for internal projects regardless of what the form submits — defense in depth even if a forged POST tries `billable=true`.
- **Never appears on an invoice.** Invoice generation flows filter out internal projects at every level: query `projects.is_internal=false`, server-action post-filter, and the entries themselves are non-billable.
- **Is still pickable in time-entry forms.** You log time on your own work, you just don't invoice it. The picker shows internal and external projects together; only invoice-related pickers exclude internal.

The DB columns:

```sql
projects.is_internal      BOOLEAN NOT NULL DEFAULT false
projects.default_billable BOOLEAN NOT NULL DEFAULT true
projects.customer_id      UUID NULL  -- nullable since migration 005
```

## Default billable — the per-project knob

`default_billable` is independent of `is_internal`. Three configurations cover every realistic case:

| `is_internal` | `default_billable` | Use case |
|---|---|---|
| false | true | Standard hourly client work. |
| false | false | Client retainer / fixed-fee — track time but don't invoice hourly. |
| true | false | Internal project. (CHECK constraint plus server action keep this combination locked — internal projects always default to non-billable.) |

New time entries created via `createTimeEntryAction`, `startTimerAction`, or `upsertTimesheetCellAction` inherit the project's `default_billable`. Per-entry override still works for the one-off case.

## Switch pathways

Every transition is supported. The "Classification" panel on the project detail page exposes them as named server actions, not regular field updates — they touch shared invariants (the CHECK constraint, bulk row updates) that the regular edit-form patch shape doesn't model.

### Toggle the per-entry default — `default_billable` field

Use the regular project edit form (the "Bill new entries by default" checkbox). Future entries inherit the new default. **Existing entries are unaffected** — historical data doesn't change retroactively. If you want to backfill past entries, see "Apply default to existing entries" below.

The checkbox is hidden for internal projects (they're pinned to `default_billable=false`). Pre-2026-05-04 you couldn't change this at all; that's the gap this feature closes.

### Flip a project to internal — "Make this an internal project"

The flip nulls `customer_id`, sets `default_billable=false`, and sets `is_internal=true` atomically. Three effects:

1. The customer link is removed.
2. Default billable flips to off.
3. Future entries can't be added to invoices.

**Blocked when:** the project has time entries on a non-void invoice. Reason: the invoice's totals are anchored to those entries' billable flag; reclassifying the project as internal would silently leave the historical invoice referencing a "non-invoiceable" project. Resolve the invoice first (void it or remove the project's entries from it).

### Flip a project to client work — "Make this client work"

Pair-toggle: the form requires you to pick a customer in the same operation. Sets `customer_id` and `is_internal=false` atomically. Existing time entries on the project are **unaffected** — they keep whatever `billable` flag they had. If you want to mark them all billable (because you're going to invoice the back catalog), use "Apply default to existing entries" separately.

### Apply default to existing entries — bulk billable update

The switch pathway the user explicitly called out: "if a project starts off with not being billable and needs to switch we need a pathway for that."

This action sets `time_entries.billable = project.default_billable` for every:

- entry on the project
- that is not on a non-void invoice (`invoice_id IS NULL` — locked-to-invoice entries keep their flag)
- that is not in trash (`deleted_at IS NULL`)

Example: Liv starts as an internal project (default_billable=false). After 6 months of logged hours, you decide to bill for it. Two-step:

1. "Make this client work" → pick the customer, project becomes external. Toggle the "Bill new entries by default" checkbox to true.
2. "Apply default to existing entries" → bulk-flips all unbilled past entries to billable=true. The next invoice picks them up.

The action is destructive (changes many rows in one click) — it shows the impact in plain language ("Set every unbilled, non-trashed time entry on this project to billable=true") and skips invoiced rows so you can't accidentally edit a row whose flag is locked to an invoice's totals.

## Where internal projects do and don't show up

| Surface | Internal projects? | Why |
|---|---|---|
| **Project list** (`/projects`) | Yes, with "Internal" badge + Building icon | You manage them like any other project. |
| **Project detail** (`/projects/[id]`) | Yes | Edit form + Classification panel for switch pathways. |
| **Customer detail** (`/customers/[id]`) | No | Internal projects have no customer; the page query already filters by `customer_id`. |
| **New time entry** | Yes | You log time on internal projects. The billable checkbox is disabled. |
| **Day / Week / Log views** | Yes | Same as any other project's entries. Billable filter respects the entry's flag (false for internal). |
| **Timer running pill** | Yes | A running timer on Liv is just as visible as on a client project. |
| **Templates** | Yes | If a template's project is internal, the resulting entry inherits billable=false. |
| **Invoice creation — preview** (`/invoices/new`) | No | The query filters `projects.is_internal=false`. |
| **Invoice creation — generate** | No | The server action filters internal projects again at the line-item-build level. Defense in depth. |
| **Existing invoices' line items** | Possibly, historically | If you had an internal-project entry on an invoice prior to this feature, it stays. New entries can't be added. |
| **Reports / Customer breakdown** (`/reports`) | Yes, bucketed under "Internal" | The label "Internal" is now reserved for `is_internal=true` only, distinct from "no customer visible to this viewer." |
| **Reports / Billable revenue** | Excluded from billable totals | Internal entries are `billable=false`, so they don't contribute to revenue. Their hours still show up in total hours. |
| **Dashboard "Unbilled hours" card** | Excluded | The card filters `billable=true AND invoiced=false`. Internal entries are billable=false, so they're already out. |
| **CSV export** | Yes | Each row's customer column is empty for internal-project entries. Existing behavior. |

## Migrating existing data

The migration (`20260504190000_internal_projects.sql`) backfills two things automatically:

1. **Existing rows with `customer_id IS NULL` are reclassified as internal.** Pre-feature, the new-project form had a "(internal project)" option that left customer_id null; those rows now get `is_internal=true, default_billable=false` so they pass the new CHECK constraint.
2. **Everything else** gets the column defaults: `is_internal=false, default_billable=true`. No behavior change for client projects.

If you have a project today that's classified incorrectly (e.g., Liv is currently under "Malcom IO" customer because Harvest imported it that way), use the "Make this an internal project" action on the project detail page. One click, atomic, blocked if there are draft invoices to clean up first.

## Server-side enforcement (defense in depth)

Even if the UI is bypassed, the database + server actions enforce the rules:

- **DB CHECK constraint** — `projects_internal_xor_customer` rejects any row with `is_internal=true AND customer_id IS NOT NULL` or vice versa. A direct INSERT/UPDATE that breaks the invariant fails.
- **Server actions on time entries** — `createTimeEntryAction`, `updateTimeEntryAction`, `startTimerAction`, `duplicateTimeEntryAction`, `upsertTimesheetCellAction` all read the project's `is_internal` and force `billable=false` regardless of the submitted value. A forged POST with `billable=true` on an internal-project entry is silently coerced to false.
- **Invoice creation** — `createInvoiceAction` and the new-invoice preview both filter `projects.is_internal=false` at the query level, with a JS-side post-filter as belt-and-suspenders.

## See also

- `docs/guides/features/customers.md` — the customer model. Internal projects intentionally sit outside it.
- `docs/guides/features/invoicing.md` — what gets invoiced and how. Internal projects don't.
- `supabase/migrations/20260504190000_internal_projects.sql` — the schema migration.
- `src/app/(dashboard)/projects/actions.ts` — `setProjectInternalAction`, `applyDefaultBillableAction`, plus the field-level updates.
- `src/app/(dashboard)/projects/[id]/project-classification.tsx` — the UI that surfaces the switch pathways.
