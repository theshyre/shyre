# All teams

`/admin/teams`. Cross-org view of every team on the platform. System admins only.

## What's shown

Per row (paginated, 50 per page):

- Org name + slug
- Created date
- Counts: members, customers, projects, time entries, invoices

## What you can do

- **View** — read-only from this page.
- **Drill in** — click org name to view its detail page (if you're a member).

## Why this exists

- Cross-org sanity check: "is that new signup actually creating stuff?"
- Capacity planning: "how many orgs have > N members / customers?"
- Spotting test-data leaks into prod (see the [sample data tool](sample-data.md) and the cleanup helper for how test orgs get created).

## Performance

Queries are scoped to the current page's orgs — 5 queries over 50 orgs at most, regardless of total platform size. Previous implementation scanned full tables and crashed once the platform hit 1500+ orgs (mostly leaked test fixtures).

## Integration-test leaks

Test fixtures create orgs with names like `itest-{run-id}-{label}'s Team`. If you see a stack of those:

1. Check the cleanup helper works — `cleanupAllTestData()` in `src/__integration__/helpers/cleanup.ts`. It filters by `name LIKE 'itest-%'`.
2. Manual nuke:

   ```sql
   DELETE FROM public.teams WHERE name LIKE 'itest-%';
   ```

   Cascades to members, settings, projects, customers, time entries. Does **not** delete auth.users (they're not FK'd from orgs); use the Supabase admin API to delete test users.

## Related

- [Users (all)](users.md)
- [Sample data tool](sample-data.md)
