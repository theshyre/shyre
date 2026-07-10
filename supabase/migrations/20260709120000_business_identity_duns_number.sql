-- Add the D-U-N-S Number to business identity.
--
-- A D-U-N-S Number is the 9-digit Dun & Bradstreet identifier that
-- registries (e.g. Apple's Developer Program for organizations,
-- government contracting via SAM.gov) require to verify a business.
-- It's compliance-tier identity — same sensitivity class as the EIN —
-- so it belongs on the role-gated `business_identity_private` child
-- table (owner|admin RLS on every operation, per SAL-012), NOT on the
-- member-readable `businesses` table.
--
-- Additive, nullable column: safe to ship with the code that reads it
-- in a single PR (migrations playbook — additive column). The CHECK
-- mirrors D&B's canonical format: exactly 9 digits, no formatting. The
-- server action strips incidental spaces/hyphens before storing, so
-- the constraint only ever sees the normalized form.
--
-- No history-table change is needed: `tg_bip_log_change` snapshots the
-- whole row via `to_jsonb(OLD)`, so D-U-N-S edits land in
-- `business_identity_private_history` automatically.

ALTER TABLE public.business_identity_private
  ADD COLUMN IF NOT EXISTS duns_number TEXT
    CHECK (duns_number IS NULL OR duns_number ~ '^[0-9]{9}$');

COMMENT ON COLUMN public.business_identity_private.duns_number IS
  'Dun & Bradstreet D-U-N-S Number — 9 digits, no formatting. Owner/admin only, same sensitivity as the EIN.';
