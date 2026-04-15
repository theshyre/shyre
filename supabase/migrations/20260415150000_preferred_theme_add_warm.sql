-- Widen user_settings.preferred_theme check to include the warm theme.
--
-- Original migration (20260414181940_user_preferences.sql) created the column
-- with CHECK (preferred_theme IN ('system','light','dark','high-contrast')).
-- The app now offers 'warm' as a fifth option — writes fail the constraint
-- until this runs.

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_preferred_theme_check;

ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_preferred_theme_check
    CHECK (
      preferred_theme IS NULL OR preferred_theme IN (
        'system', 'light', 'dark', 'high-contrast', 'warm'
      )
    );

COMMENT ON COLUMN user_settings.preferred_theme IS
  'system|light|dark|high-contrast|warm. NULL = follow system.';
