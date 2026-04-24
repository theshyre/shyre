# Migrations & deploy ordering

> Full playbook. The short version lives in `CLAUDE.md` → "Migrations & deploy ordering — MANDATORY".

## Why ordering matters

Vercel auto-deploys app code on every push to `main`. The `.github/workflows/db-migrate.yml` workflow applies SQL migrations to prod on the same push. These two jobs run **in parallel** — there is no sequencing. A change that couples app code to a schema change can briefly see one without the other.

## Additive migrations — safe

`ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY`, adding a nullable FK, adding a new enum value: safe to ship in a single PR with the code that uses them. If the migration lands first, the column is unused (fine). If the code lands first, queries against the new column fail gracefully (Supabase returns `{ data: null, error: ... }`, server code falls back to `[]`) and recover the moment the migration finishes seconds later. Use `IF NOT EXISTS` everywhere so retries are idempotent.

## Destructive migrations — two-PR dance

`DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... NOT NULL` without default, renaming, narrowing a type: ship in two PRs, never one.

1. **PR 1 — stop reading/writing the thing.** Code change only. Remove every reference to the old column. Merge. Wait for Vercel to deploy.
2. **PR 2 — drop the thing.** Migration only. Merge.

Skipping the dance means the old code is still live in Vercel the moment the migration runs, and whatever was talking to that column starts failing (or worse, silently losing data).

## Renames

Renames are destructive twice over — the old name goes away and the new name appears. Use a three-step expand-contract: add the new column, backfill + dual-write, flip reads, then drop the old column. This is how `rename_organizations_to_teams` was done; copy that pattern.

## Allow-lists and DB check constraints must match

Any app-level `ALLOWED_*` set that backs a DB column with a `CHECK (col IN (...))` constraint must match the constraint exactly. Adding a value to the set without widening the DB constraint → runtime 23514 errors on writes (how the "warm" theme incident hit prod). Removing from the set without tightening → dead data in the DB.

**Workflow for changes:**

1. Keep the allow-list in a plain module next to `actions.ts` (e.g. `allow-lists.ts`) so tests and server actions can both import it without a `"use server"` boundary.
2. Write a migration that `DROP CONSTRAINT IF EXISTS … ; ADD CONSTRAINT … CHECK (col IS NULL OR col IN (...))` in the same PR.
3. `src/__tests__/db-parity.test.ts` walks every migration and compares each known column's effective CHECK set against the app allow-list. Red = drift.

Adding a new allow-list pair: export it from the relevant `allow-lists.ts`, wire it into the `PAIRS` array in `db-parity.test.ts`, and ship the migration.

## Timestamps must be monotonic

Migration filenames sort lexically. A migration with a timestamp earlier than any already-applied migration on prod cannot be applied without `--include-all`, which pollutes history. Before creating a migration, check the most recent file under `supabase/migrations/` and use a strictly-later timestamp. If you have to rename after the fact to restore order, do it before the CI action tries to apply.

## Secrets & ops

- Prod migrations need `SUPABASE_DB_URL` repo secret (session-pooler URI, port 5432). Without it, `db-migrate.yml` fails loudly — treat that as a fire, not a warning.
- Local `npm run db:push` and the GH Action are interchangeable; the migration table dedupes. If you apply locally because CI is slow, the action will no-op on the next push.
- Never disable the `db-verify.yml` PR check to get a merge through. If it's red, the migration is broken — fix it, don't route around it.
