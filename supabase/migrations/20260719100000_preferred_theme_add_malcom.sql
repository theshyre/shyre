-- Widen user_settings.preferred_theme to include the malcom brand theme
-- (@theshyre/design-tokens 0.7.0). Same pattern as 20260415150000.

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_preferred_theme_check;

ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_preferred_theme_check
    CHECK (
      preferred_theme IS NULL OR preferred_theme IN (
        'system', 'light', 'dark', 'high-contrast', 'warm', 'malcom'
      )
    );

COMMENT ON COLUMN user_settings.preferred_theme IS
  'system|light|dark|high-contrast|warm|malcom. NULL = follow system.';
