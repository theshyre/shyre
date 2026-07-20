-- Two small defense-in-depth items from the 2026-07-19 audit.
--
-- 1. /system/deploy selected the raw Vercel api_token only to compute
--    Boolean(cfg?.api_token). SAL-028 pattern: a generated presence
--    column so the page render query never carries the secret bytes.
--
-- 2. The public branding bucket allowed image/svg+xml. App surfaces
--    render logos via <img> and the PDF path is PNG/JPEG-only (SAL-041),
--    so there is no app-origin XSS — but a directly-opened stored SVG
--    executes script on the storage origin. Nothing in the app needs SVG
--    upload; drop it from the allow-list. Existing SVG objects (if any)
--    remain readable; new uploads are refused.

ALTER TABLE instance_deploy_config
  ADD COLUMN IF NOT EXISTS has_api_token BOOLEAN
  GENERATED ALWAYS AS (api_token IS NOT NULL) STORED;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
WHERE id = 'branding';
