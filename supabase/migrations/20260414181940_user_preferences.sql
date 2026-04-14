-- User preferences (Phase 5+)
--
-- Per-user display preferences: theme, timezone, locale, week start,
-- time format. These were previously localStorage-only (theme) or
-- browser-detected (timezone). Storing them in user_settings makes
-- them portable across devices.
--
-- All columns are nullable so existing users keep "auto" behavior:
--   NULL preferred_theme → system theme
--   NULL timezone        → browser-detected
--   NULL locale          → app default (en)
--   NULL week_start      → monday (ISO default)
--   NULL time_format     → locale default

ALTER TABLE user_settings
  ADD COLUMN preferred_theme TEXT
    CHECK (preferred_theme IS NULL OR preferred_theme IN ('system', 'light', 'dark', 'high-contrast')),
  ADD COLUMN timezone TEXT,
  ADD COLUMN locale TEXT
    CHECK (locale IS NULL OR locale IN ('en', 'es')),
  ADD COLUMN week_start TEXT
    CHECK (week_start IS NULL OR week_start IN ('monday', 'sunday')),
  ADD COLUMN time_format TEXT
    CHECK (time_format IS NULL OR time_format IN ('12h', '24h'));

-- Also surface avatar_url in the row since we're adding profile UI.
-- (column already exists on user_profiles; noop here)

COMMENT ON COLUMN user_settings.preferred_theme IS 'system|light|dark|high-contrast. NULL = follow system.';
COMMENT ON COLUMN user_settings.timezone IS 'IANA tz name (e.g. America/Los_Angeles). NULL = browser-detected.';
COMMENT ON COLUMN user_settings.locale IS 'en|es. NULL = app default (en).';
COMMENT ON COLUMN user_settings.week_start IS 'monday|sunday. NULL = monday (ISO).';
COMMENT ON COLUMN user_settings.time_format IS '12h|24h. NULL = locale default.';
