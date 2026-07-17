-- ============================================================
-- Branding — per-customer co-brand (accent color + logo)
-- ============================================================
--
-- Part 2 of branding. A proposal is a document FROM the team TO a customer, so
-- both sides can carry identity: the team logo (20260717140000) plus, here,
-- the customer's own accent color and logo, rendered as a subtle co-brand on
-- the proposal PDF + the public sign page.
--
--   accent_color — hex, same CHECK shape as team_settings.brand_color. When
--                  null, the customer's deterministic CustomerChip color (a
--                  hash of the id) is the visual identity; this is an explicit
--                  override for the client-facing document.
--   logo_url     — an uploaded logo in the SAME public `branding` bucket as
--                  team logos, stored under `<team_id>/customers/<id>/…`. The
--                  bucket's team-folder RLS (owner/admin of the first path
--                  segment) already covers it — a customer belongs to a team,
--                  and the app writes under that team's folder. Writes are
--                  validated app-side by `isOwnBrandingUrl` + the customer's
--                  team, same as the team logo (SAL-041).
--
-- Additive: two nullable columns + one CHECK. Timestamp sorts after
-- 20260717140000.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS accent_color TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_accent_color_hex;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_accent_color_hex CHECK (
    accent_color IS NULL
    OR accent_color ~ '^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$'
  );

COMMENT ON COLUMN public.customers.accent_color IS
  'Optional hex co-brand accent for client-facing proposal surfaces. Null → the hashed CustomerChip color is used.';
COMMENT ON COLUMN public.customers.logo_url IS
  'Optional customer logo in the public branding bucket (<team_id>/customers/<id>/…). Validated app-side by isOwnBrandingUrl. See SAL-041.';
