-- Branding fields on team_settings — used by the invoice PDF (and
-- eventually any other "outward-facing" surface) to render a
-- two-tone text wordmark in the top-left corner.
--
-- Three nullable columns; all default to NULL. When all three are
-- NULL, the PDF falls back to plain business_name in the default
-- ink color (current behavior preserved).
--
--   wordmark_primary   -- first half of the wordmark, rendered in
--                         brand_color when set. Defaults to
--                         business_name when null.
--   wordmark_secondary -- second half, rendered in default ink.
--                         Used for the ".io" / ".com" style suffix
--                         in compound wordmarks.
--   brand_color        -- hex color (e.g. "#7BAE5F") applied to the
--                         primary wordmark. Validated as a 4 or 7
--                         char hex literal so a typo can't blow up
--                         @react-pdf/renderer at PDF time.
--
-- Authorization: existing team_settings RLS already gates updates
-- on team_role IN ('owner', 'admin'). No new policy needed —
-- branding is a settings-level concern, same gate as the other
-- fields on the row.
--
-- Why text over image upload (for now): bypasses Supabase Storage
-- + image-resizing + content-type validation. The Harvest example
-- the user pointed at is itself a text wordmark, not a raster
-- logo — text covers their actual case. Logo-image upload remains
-- a future addition (logo_url already exists on the table; the UI
-- just doesn't surface it yet).

ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS wordmark_primary   TEXT,
  ADD COLUMN IF NOT EXISTS wordmark_secondary TEXT,
  ADD COLUMN IF NOT EXISTS brand_color        TEXT;

-- Length cap: 50 chars per wordmark half is more than any
-- reasonable wordmark needs and prevents the PDF layout from
-- buckling under user input.
ALTER TABLE public.team_settings
  ADD CONSTRAINT team_settings_wordmark_primary_length
    CHECK (
      wordmark_primary IS NULL OR length(wordmark_primary) BETWEEN 1 AND 50
    ),
  ADD CONSTRAINT team_settings_wordmark_secondary_length
    CHECK (
      wordmark_secondary IS NULL OR length(wordmark_secondary) BETWEEN 1 AND 50
    );

-- Hex color: enforce #RGB or #RRGGBB so a malformed value can't
-- crash @react-pdf/renderer (which throws on bad colors at PDF
-- generation time, with a stack trace from a worker thread that
-- the user never sees).
ALTER TABLE public.team_settings
  ADD CONSTRAINT team_settings_brand_color_hex
    CHECK (
      brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$'
    );

COMMENT ON COLUMN public.team_settings.wordmark_primary IS
  'Primary half of branded wordmark, rendered in brand_color. Falls back to business_name when null.';
COMMENT ON COLUMN public.team_settings.wordmark_secondary IS
  'Secondary half (e.g. ".io") rendered in default ink, paired with wordmark_primary.';
COMMENT ON COLUMN public.team_settings.brand_color IS
  'Hex color (#RGB or #RRGGBB) applied to wordmark_primary on outward-facing surfaces (invoice PDF).';

-- Rewrite team_settings_v to surface the new columns. Postgres
-- refuses CREATE OR REPLACE when adding columns to a view's SELECT
-- list — drop-and-recreate, same shape the prior identity-move
-- migration (20260420170001) used.
DROP VIEW IF EXISTS public.team_settings_v;

CREATE VIEW public.team_settings_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  ts.team_id,
  ts.business_name,
  ts.business_email,
  ts.business_address,
  ts.business_phone,
  ts.logo_url,
  CASE WHEN public.can_view_team_rate(ts.team_id) THEN ts.default_rate ELSE NULL END AS default_rate,
  ts.invoice_prefix,
  ts.invoice_next_num,
  ts.tax_rate,
  ts.wordmark_primary,
  ts.wordmark_secondary,
  ts.brand_color,
  ts.created_at,
  ts.updated_at,
  ts.rate_visibility,
  ts.rate_editability
FROM public.team_settings ts;
