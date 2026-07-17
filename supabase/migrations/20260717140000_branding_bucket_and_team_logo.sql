-- ============================================================
-- Branding — team logo storage (activate the dead team_settings.logo_url)
-- ============================================================
--
-- `team_settings.logo_url` has existed since the multi-org migration but was
-- never surfaced (a team could set a text wordmark + brand color, never an
-- image). This adds the storage half so a team can upload a real logo that
-- renders on the proposal PDF and the public sign page.
--
-- Public `branding` bucket, mirroring the `avatars` bucket precedent
-- (20260414185403). Files live at `<team_id>/<filename>` — the first path
-- segment scopes writes to a team, and only an owner/admin of that team may
-- write (avatars scope to a user; branding scopes to a team). Public read,
-- because the logo must render on the login-free /sign page and in a
-- client-downloaded PDF. See SAL-041.
--
-- Additive: one bucket + four storage.objects policies. No column changes
-- (logo_url already exists). Timestamp sorts after 20260717130000.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  true,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read: the logo renders on the anon /sign page and in PDFs.
DROP POLICY IF EXISTS "branding: public read" ON storage.objects;
CREATE POLICY "branding: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

-- Write = owner/admin of the team whose id is the first path segment. The
-- uuid-format guard short-circuits before the ::uuid cast, so a crafted
-- non-uuid folder is a clean deny (never a cast error). `user_team_role` is
-- SECURITY DEFINER over the current auth.uid() — the SAL-003 lesson (helper,
-- not inline recursive EXISTS).
DROP POLICY IF EXISTS "branding: team admin insert" ON storage.objects;
CREATE POLICY "branding: team admin insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.user_team_role(((storage.foldername(name))[1])::uuid) IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS "branding: team admin update" ON storage.objects;
CREATE POLICY "branding: team admin update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.user_team_role(((storage.foldername(name))[1])::uuid) IN ('owner', 'admin')
  )
  WITH CHECK (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.user_team_role(((storage.foldername(name))[1])::uuid) IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS "branding: team admin delete" ON storage.objects;
CREATE POLICY "branding: team admin delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.user_team_role(((storage.foldername(name))[1])::uuid) IN ('owner', 'admin')
  );
