-- SAL-012 contract phase — drop the deprecated identity columns
-- from `businesses`.
--
-- The expand phase (20260428024320_sal012_business_identity_rls.sql)
-- moved tax_id / date_incorporated / fiscal_year_start to the
-- role-gated `business_identity_private` table, NULL'd the source
-- columns, and updated every reader / writer in the app:
--
--   - src/app/(dashboard)/business/actions.ts                     ✓
--   - src/app/(dashboard)/business/[businessId]/identity/page.tsx ✓
--   - src/app/(dashboard)/admin/sample-data/actions.ts            ✓
--   - identity-form (UI gates rendering by canEditPrivate)        ✓
--
-- A grep across `src/` confirms no remaining production code reads
-- those columns off `businesses`. Per the migrations playbook
-- ("Destructive migrations: two PRs, never one"), this is the
-- contract migration that drops them. It can be reverted
-- independently if needed.
--
-- Note: existing rows in `businesses_history` retain the dropped
-- column values inside their JSONB `previous_state` blobs — the
-- history label map (`BUSINESS_FIELD_LABELS`) keeps the labels for
-- tax_id / date_incorporated / fiscal_year_start so old timelines
-- render correctly.

ALTER TABLE public.businesses
  DROP COLUMN IF EXISTS tax_id,
  DROP COLUMN IF EXISTS date_incorporated,
  DROP COLUMN IF EXISTS fiscal_year_start;
