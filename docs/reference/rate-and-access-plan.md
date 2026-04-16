# Rate & cross-member access plan

> **Status:** Phase 1 shipped (SAL-006). Phase 2 design under review. Phases 3–4 queued.
>
> **Principle:** Every rate and every piece of cross-member data is **closed by default**. Visibility is opt-in at the object level (per-team, per-project, per-customer, per-member). A team member logging their hours sees only their own hours and no rates at all, unless the owner has explicitly opened one of those surfaces up.

## Context

An audit on 2026-04-16 initially flagged three RLS gaps. Verifying against `pg_policies` on the live DB showed only **one** is a current issue — the other two had already been resolved in later migrations and the initial audit relied on a stale reading of migration 002 alone:

| Original finding | Current state |
|---|---|
| `user_settings` readable by any team member | **Already resolved** in migration 004 (`user_settings` was slimmed down and the policy reverted to `USING (auth.uid() = user_id)`) |
| `time_entries` fully mutable by any team member | **Partially wrong.** Write-side (INSERT / UPDATE / DELETE) was tightened in migration 009 — members can only insert / update / delete their own entries, admins/owners the rest. **SELECT remained loose** — any team member can still read any other member's entries. This is the one real Phase 1 fix. |
| `projects` / `customers` writes | **Already resolved.** Migration 009 split project UPDATE/DELETE to owner/admin only (internal) or customer-admin (customer-linked). Migration 20260414213128 tightened `customers_update` to customer-admin only. A member cannot modify a project's `hourly_rate` or a customer's `default_rate`. |

So Phase 1 ships a **single** SAL fix (`SAL-006`): tighten `time_entries_select`.

The audit also exposed that Shyre has no per-member bill rate at all — only project / customer / team defaults. Multi-person teams can't represent "senior dev at $200/hr, junior at $100/hr." Phase 2 adds the per-member rate plus a per-object permission model. That work is unchanged by the correction — it's new feature work, not a security fix.

A separate concern the audit also surfaced: **rate columns are currently readable by every team member** (via the various `_select` policies on `projects`, `customers`, `team_settings`). Writes are gated, reads are not. This is not a bug per se — it's the current model — but it's exactly what the rate-visibility work in Phase 2 addresses via column-masked views.

## Principles

1. **Default closed.** Every new rate-visibility / data-access flag defaults to the most restrictive level. Opening up is an explicit owner action.
2. **Per-object config.** Visibility is set per-project, per-customer, per-member, per-team-settings. No single team-wide "everyone sees rates" toggle. A team can have one open project and ten closed ones.
3. **Members can't see their own rate by default.** This is stronger than the usual default. The member's own rate is still gated by the `team_members.rate_visibility` flag; `self` is a distinct level that only opens up the member's own rate without opening anyone else's.
4. **RLS is done in the database, not the app.** Column-masking via views + SECURITY DEFINER helpers. App layer cannot forget to filter, because the underlying rows never surface forbidden data.
5. **Role model is extensible.** Permission levels stored as CHECK-constrained `TEXT` enums so new roles (e.g. `billing_admin`, `project_lead`) can land as a one-line `ALTER TYPE` / updated CHECK without a schema redesign.

## The four phases

### Phase 1 — tighten `time_entries_select` (one SAL, shipped)

Single migration + integration test + audit log entry.

| SAL | Table | Fix |
|---|---|---|
| SAL-006 | `time_entries` | Replace middle `USING` clause from `user_has_team_access(team_id)` to `user_team_role(team_id) IN ('owner', 'admin')`. Members now see only their own entries; owner/admin see everything; the cross-team customer-share clause is preserved. |

**What Phase 1 does NOT do:** add new features, change schema, touch the rate model, alter any INSERT / UPDATE / DELETE policy (those were already correct), or add a config surface for opt-in looser defaults (that's Phase 3).

**App impact:** server components that queried `time_entries` without an explicit `user_id` filter used to return all team entries; under the tight default they now return only the caller's own entries when the caller is a plain member. Owner/admin views are unchanged. The reports page, business dashboard, and time-entries list all behave correctly — in fact they now match the design intent ("members log their own time and nothing else").

### Phase 2 — rate model + permission views (design under review)

**Schema additions (all additive, reversible):**

```sql
-- Per-member rate (new column)
ALTER TABLE team_members
  ADD COLUMN default_rate NUMERIC(10,2),
  ADD COLUMN rate_visibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_visibility IN ('owner', 'admins', 'self', 'all_members'));

-- Per-project rate visibility (rate column already exists)
ALTER TABLE projects
  ADD COLUMN rate_visibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_visibility IN ('owner', 'admins', 'all_members'));

-- Per-customer rate visibility (rate column already exists)
ALTER TABLE customers
  ADD COLUMN rate_visibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_visibility IN ('owner', 'admins', 'all_members'));

-- Per-team default rate visibility (rate column already exists)
ALTER TABLE team_settings
  ADD COLUMN rate_visibility TEXT NOT NULL DEFAULT 'owner'
    CHECK (rate_visibility IN ('owner', 'admins', 'all_members'));
```

**Open design question:** Do we need `rate_editability` separate from `rate_visibility`? The "separate" model lets an admin view rates for reports without being authorized to change them. Two columns per rate-bearing table, doubled helpers and views. The "tied" model collapses them — if you can see the rate, you can edit it (subject to the usual role check for editing the row).

**Helpers (SECURITY DEFINER, STABLE):**

```sql
can_view_project_rate(project_id)   — returns true if caller meets the row's visibility threshold
can_view_customer_rate(customer_id)
can_view_team_rate(team_id)
can_view_member_rate(membership_id)

-- If we go with separate edit permissions, mirror each as can_set_*.
```

**Views (column-masking):**

```sql
CREATE VIEW projects_v AS
SELECT
  id, team_id, customer_id, name, status, ...,  -- every non-rate column
  CASE WHEN can_view_project_rate(id) THEN hourly_rate ELSE NULL END AS hourly_rate,
  rate_visibility
FROM projects;

CREATE VIEW customers_v AS SELECT ..., CASE WHEN can_view_customer_rate(id) ... FROM customers;
CREATE VIEW team_members_v AS SELECT ..., CASE WHEN can_view_member_rate(id) ... FROM team_members;
CREATE VIEW team_settings_v AS SELECT ..., CASE WHEN can_view_team_rate(team_id) ... FROM team_settings;
```

**App contract:**

- **Reads:** route through `*_v` views. Callers see `NULL` where they can't see the rate. No forgetting to filter.
- **Writes:** server actions that touch a rate column call the helper first and 403 if the caller can't set it. RLS `UPDATE` policies give belt-and-suspenders (SECURITY DEFINER in the server action, RLS in the DB).

**Rate resolution cascade** (used by invoice builder, time-entry rate display, etc.):

```
project.hourly_rate
  → customer.default_rate
    → team_members.default_rate (for the user who logged the time)
      → team_settings.default_rate
```

Highest non-null wins. If every layer is null or the caller can't see the rate, the UI shows nothing (not zero — nothing).

### Phase 3 — time_entries configurable visibility

Builds on Phase 1's tight default. Adds config knobs:

```sql
ALTER TABLE team_settings
  ADD COLUMN time_entries_visibility TEXT NOT NULL DEFAULT 'own_only'
    CHECK (time_entries_visibility IN ('own_only', 'read_all', 'read_write_all'));

ALTER TABLE projects
  ADD COLUMN time_entries_visibility TEXT  -- NULL = inherit team
    CHECK (time_entries_visibility IS NULL OR time_entries_visibility IN ('own_only', 'read_all', 'read_write_all'));
```

RLS policies on `time_entries` read the effective level via a helper `effective_time_entries_visibility(project_id, team_id)` that prefers the per-project value then falls back to the team. Admin/owner are always at `read_write_all`.

### Phase 4 — UI, docs, naming

- Admin UI: team settings → "Rate & visibility" section. Per-project / per-customer / per-member toggles on their respective detail pages.
- Admin UI: team settings → "Time entry visibility" section, plus per-project override.
- Docs: update `database-schema.md` with the new columns and views; add a section on the permission model.
- Role naming: UI copy shows "Contributor" for `role = 'member'`; schema stays `'member'`. Disambiguates from "team member" (the junction).

## Open questions (block Phase 2)

1. **View vs edit permissions:** tied or separate? (See above.)
2. **Per-member rate visibility "self" level:** confirm — `self` means only the member themselves can see their own rate; admins and owner see it via their admin/owner level. `all_members` means every member sees every other member's rate. Correct?
3. **Who sets `rate_visibility` on objects?** Owner-only? Admin+? Needed both for the migration default and the server actions.

Once these are answered, Phase 2 is buildable.

## Related

- `docs/security/SECURITY_AUDIT_LOG.md` — `SAL-006`
- `docs/reference/database-schema.md` — will be updated as each phase lands
- `docs/personas/security-reviewer.md` — the lens that should catch over-permissive policies in review; needs a check for "latest policy on each table via pg_policies, not just the policy body in the latest touching migration"
