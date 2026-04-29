-- User table-density preference
--
-- Mirrors text_size: three-tier compactness toggle that lets the user
-- pick how dense data tables render. Applied via data-density on
-- opt-in <div> wrappers + CSS variables that scale row padding +
-- cell font size. localStorage is the session-level cache for
-- anti-flash; user_settings.table_density is the cross-device source
-- of truth, synced by TableDensitySync on login.
--
-- Defaults to NULL so existing users get the regular default until
-- they explicitly pick a level. CSV import recategorize is the use
-- case driving this — 39 rows post-import is too tall to scan at
-- regular density.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS table_density TEXT
    CHECK (table_density IN ('compact', 'regular', 'comfortable'));
