-- User text-size preference
--
-- Matches Liv's three-tier text scaling: compact / regular / large.
-- Applied via data-text-size on <html> + a root font-size, so every rem
-- in the app scales uniformly. localStorage is the session-level cache
-- for anti-flash; user_settings.text_size is the cross-device source
-- of truth, synced by ThemeSync on login.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS text_size TEXT
    CHECK (text_size IN ('compact', 'regular', 'large'));
