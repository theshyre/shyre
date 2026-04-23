-- Import audit trail columns on customers / projects / time_entries.
--
-- Today's Harvest importer silently attributes everything to the
-- running user and leaves no trace of what came from where. If an
-- import goes wrong, the user has no clean way to undo it — they have
-- to visually pick through their data and delete by hand. And because
-- dedupe is by display name, re-importing a renamed row creates a
-- duplicate.
--
-- Four columns, all nullable (real user-entered rows never get them):
--
--   imported_from       — 'harvest' | future values as other importers
--                         land. Free text with a CHECK rather than an
--                         enum so we can add sources without migrating.
--   imported_at         — when the import happened (timestamp of the
--                         run, same across a run's rows).
--   import_run_id       — a UUID per import run. One import = one id.
--                         Clicking "Undo" deletes all rows with this id
--                         in a single query.
--   import_source_id    — the external system's ID for this row
--                         (Harvest client.id / project.id / time_entry.id).
--                         Enables idempotent re-imports: look up by
--                         (imported_from, import_source_id) instead of
--                         matching on name, so renaming in Harvest
--                         doesn't cause a duplicate in Shyre.
--
-- A partial unique index per (team_id, imported_from, import_source_id)
-- enforces that the same external row can't land twice in the same
-- team. Rows with NULL source_id (hand-entered) don't participate.

-- customers
ALTER TABLE public.customers
  ADD COLUMN imported_from    TEXT
    CHECK (imported_from IS NULL OR imported_from IN ('harvest')),
  ADD COLUMN imported_at      TIMESTAMPTZ,
  ADD COLUMN import_run_id    UUID,
  ADD COLUMN import_source_id TEXT;

CREATE UNIQUE INDEX customers_import_source_unique
  ON public.customers (team_id, imported_from, import_source_id)
  WHERE import_source_id IS NOT NULL;

CREATE INDEX customers_import_run_idx
  ON public.customers (import_run_id)
  WHERE import_run_id IS NOT NULL;

-- projects
ALTER TABLE public.projects
  ADD COLUMN imported_from    TEXT
    CHECK (imported_from IS NULL OR imported_from IN ('harvest')),
  ADD COLUMN imported_at      TIMESTAMPTZ,
  ADD COLUMN import_run_id    UUID,
  ADD COLUMN import_source_id TEXT;

CREATE UNIQUE INDEX projects_import_source_unique
  ON public.projects (team_id, imported_from, import_source_id)
  WHERE import_source_id IS NOT NULL;

CREATE INDEX projects_import_run_idx
  ON public.projects (import_run_id)
  WHERE import_run_id IS NOT NULL;

-- time_entries
ALTER TABLE public.time_entries
  ADD COLUMN imported_from    TEXT
    CHECK (imported_from IS NULL OR imported_from IN ('harvest')),
  ADD COLUMN imported_at      TIMESTAMPTZ,
  ADD COLUMN import_run_id    UUID,
  ADD COLUMN import_source_id TEXT;

CREATE UNIQUE INDEX time_entries_import_source_unique
  ON public.time_entries (team_id, imported_from, import_source_id)
  WHERE import_source_id IS NOT NULL;

CREATE INDEX time_entries_import_run_idx
  ON public.time_entries (import_run_id)
  WHERE import_run_id IS NOT NULL;

-- categories + category_sets auto-created by an importer should also
-- carry the audit trail so they can be cleaned up with the parent run.
ALTER TABLE public.category_sets
  ADD COLUMN imported_from    TEXT
    CHECK (imported_from IS NULL OR imported_from IN ('harvest')),
  ADD COLUMN imported_at      TIMESTAMPTZ,
  ADD COLUMN import_run_id    UUID,
  ADD COLUMN import_source_id TEXT;

CREATE INDEX category_sets_import_run_idx
  ON public.category_sets (import_run_id)
  WHERE import_run_id IS NOT NULL;

ALTER TABLE public.categories
  ADD COLUMN imported_from    TEXT
    CHECK (imported_from IS NULL OR imported_from IN ('harvest')),
  ADD COLUMN imported_at      TIMESTAMPTZ,
  ADD COLUMN import_run_id    UUID,
  ADD COLUMN import_source_id TEXT;

CREATE INDEX categories_import_run_idx
  ON public.categories (import_run_id)
  WHERE import_run_id IS NOT NULL;
