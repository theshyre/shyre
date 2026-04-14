-- Duration-only projects (Phase 5)
--
-- Some projects care about precise start/end timestamps (e.g. when billing
-- hourly or integrating with calendars). Others — most solo-consultant work —
-- only care about "I spent 3h 15m on this yesterday." This flag lets a
-- project opt into either mode.
--
-- require_timestamps = true  → existing behavior; forms require start + end
-- require_timestamps = false → simplified form with just date + duration;
--                              start_time is stored as midnight of the date,
--                              end_time = start_time + duration_min

ALTER TABLE projects
  ADD COLUMN require_timestamps BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN projects.require_timestamps IS
  'When true, entries need explicit start/end. When false, entries are just a date + duration.';
