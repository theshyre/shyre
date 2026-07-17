-- Per-proposal sign-page theme (default light).
--
-- The public /sign page + the internal preview render the proposal in this
-- fixed color theme rather than following each client's OS dark/light
-- preference. A client-facing document should look consistent (like the PDF /
-- letterhead), and the author pins the look when drafting.
--
-- Additive + NOT NULL DEFAULT 'light' backfills every existing row with the
-- new default. The app reads the column via `select` and falls back to 'light'
-- when it's absent (parallel-deploy window) or unknown, so it fail-safes to
-- the default look, never a broken render. The allow-list `ALLOWED_SIGN_THEMES`
-- in proposals/allow-lists.ts is pinned to this CHECK by db-parity.test.ts.
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS sign_theme text NOT NULL DEFAULT 'light'
    CHECK (sign_theme IN ('light', 'dark', 'warm'));

COMMENT ON COLUMN proposals.sign_theme IS
  'Color theme the client sees on the public sign page + preview (light|dark|warm), pinned by the author. Default light — a client-facing document should not drift with each recipient''s OS theme.';
