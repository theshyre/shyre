# Sample data tool

`/admin/sample-data`. Loads, replays, and clears fabricated customers / projects / time entries / expenses into an team so you can test the UI with realistic density.

Only visible to system administrators.

## What you can do

The page always targets **one** org at a time. The current target is shown in a big banner at the top.

### Load sample data

Inserts into the targeted org:
- 4 customers: Acme Corp, Globex Corporation, Initech, Hooli
- 6 projects across them (one customer-less "Internal R&D")
- ~300–500 time entries across the last 12 weeks (weekday-heavy, varied durations, mix billable/non-billable, some GitHub issues)
- ~70–190 expenses across the last 12 months (realistic vendors and categories, some billable to projects)

All rows are tagged `is_sample = true` so they can be removed selectively.

**Idempotent**: if the org already has sample rows, they're deleted first and replaced with a fresh spread. Button label becomes "Replay sample data" in this case.

### Remove sample data

Deletes **only** rows with `is_sample = true` in the targeted org. Real customers, projects, entries, and expenses are untouched.

### Clear ALL org data

Destructive. Deletes every customer / project / time entry / expense in the targeted org — sample and real alike. Requires typing the org name exactly to confirm. Invoices and team settings are left alone.

## Permissions

- System admin (platform-level) — required to see the page at all.
- **Plus** owner or admin of the target org — RLS requires this for the deletes.

If you're system admin but not a member of a given org, you can't target it from this tool. Join it first, or do the work manually.

## Counts panel

Below the target banner: total counts plus sample counts per entity, and the entry-date range. Lets you see at a glance what's real vs. generated.

## Deterministic generation

The generator uses a seeded PRNG, so loading on the same date produces the same spread of entries. Re-load on a later date: different spread (new weeks come into scope).

## When to use this

- First-time UX evaluation — empty states look fine with zero rows but behaviors differ at scale.
- Testing reports, billable-filter toggles, week/day nav.
- Onboarding a new contributor to the codebase — fresh DB with real-shaped data.

## When NOT to use this

- Don't load sample data into customer-facing production orgs. It will appear in their invoices, reports, and exports until removed.
- Don't use **Clear ALL org data** on an org that has real data you want to keep.

## Related

- [Error log](error-log.md)
- [Env configuration](env-configuration.md)
- Reference: [sample-data generator](../../../src/lib/sample-data/generate.ts)
