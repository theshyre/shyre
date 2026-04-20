-- Flip the default for projects.require_timestamps from true → false.
--
-- Rationale: the vast majority of consulting work (Shyre's primary use
-- case) is logged as "I spent 3h on this yesterday", not as precise
-- start/end timestamps. The original default assumed the inverse; in
-- practice `require_timestamps = true` is the rare exception (hourly
-- billing that lines up to calendar blocks, integrations that need
-- exact ranges). Flipping the default aligns with real usage.
--
-- This only changes the default for NEW inserts that don't set the
-- column explicitly. Existing project rows keep whatever they had —
-- no backfill, no behavior change for live data. The two app-side
-- entry points that create projects (new-project-form.tsx and the
-- sample-data seed) already write an explicit value, so they're
-- unaffected; the default is the safety net for other callers.

ALTER TABLE projects
  ALTER COLUMN require_timestamps SET DEFAULT false;

COMMENT ON COLUMN projects.require_timestamps IS
  'When true, entries need explicit start/end. When false (default), entries are just a date + duration.';
