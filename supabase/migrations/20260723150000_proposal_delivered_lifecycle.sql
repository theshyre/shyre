-- Proposal delivery: a converted proposal reaches a terminal "delivered"
-- sub-state once the engagement's work is done.
--
-- Design decision (3-persona review 2026-07-23 — solo-consultant /
-- platform-architect / agency-owner): "delivered" is NOT a new proposal
-- status. It is a nullable `delivered_at` stamp on a proposal that stays in
-- the EXISTING terminal `converted` status — the exact mirror of project
-- close-out (20260630120000), which chose a `closed_at` stamp over a 5th
-- status. Reasons:
--   - `converted` is the "deal authorized + work created" state that four
--     billing / total / filter call sites key on (`accepted || converted`):
--     createInvoiceFromProposalAction, the CreateInvoiceButton render gate,
--     displayProposalTotal, and the list "history" filter bucket. Demoting
--     `converted` from terminal (a real 5th status) would silently block
--     invoicing a delivered proposal and mislabel its list Total.
--   - The forward-only proposal status graph (src/lib/proposals/status.ts)
--     rejects reverse transitions; a reversible "reopen" would need a
--     completed→converted back-edge. A `delivered_at` stamp needs no status
--     transition at all — deliver / reopen just set / clear the timestamp.
--   - CHECK (delivered_at IS NULL OR status = 'converted') makes a
--     "delivered" draft / sent / superseded proposal physically
--     unrepresentable, rather than merely guarded in code.
--
-- DATE vs TIMESTAMPTZ rule: a system-stamped lifecycle event is TIMESTAMPTZ
-- (matches created_at / projects.closed_at), not a user-picked DATE.
--
-- Two additive, nullable columns + one CHECK + two enum widenings. Purely
-- additive: every existing row gets NULLs which pass the CHECK immediately.
-- Single PR per docs/reference/migrations.md.

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Couple delivered_at to status: delivery is a sub-state of `converted`
-- only. Mirrors projects_closed_at_requires_terminal_status. Passes on all
-- existing rows (delivered_at NULL). This compound CHECK mentions `status`
-- but is NOT `status IN (...)`, so db-parity's enum parser correctly skips
-- it (same exemption as projects' closed_at check).
ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_delivered_at_requires_converted;
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_delivered_at_requires_converted
    CHECK (delivered_at IS NULL OR status = 'converted');

-- ============================================================
-- The delivered_at / delivered_by_user_id columns must be mutable on a
-- frozen (post-draft) proposal, or the first deliver UPDATE on a `converted`
-- row trips the send-lock guard's DEFAULT-DENY (SAL-034 lesson). Add them to
-- the mutable[] allow-list; every other branch of the guard is byte-identical
-- to 20260721120000. CREATE OR REPLACE — no schema change, additive/safe.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_proposals_send_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  -- Columns that MAY change after a proposal leaves draft: lifecycle status +
  -- its trigger-stamped timestamps, the acceptance-computed total, actor
  -- stamps, FK columns that referential actions (ON DELETE SET NULL) must be
  -- able to clear, and the delivery stamp (a post-convert lifecycle event).
  -- Everything else — title, terms, dates, customer — is frozen; a revision
  -- is a NEW version (P4). DEFAULT-DENY: columns added by future migrations
  -- are locked until deliberately added here (SAL-034 lesson).
  mutable CONSTANT text[] := ARRAY[
    'status', 'sent_at', 'viewed_at', 'accepted_at', 'declined_at',
    'converted_at', 'accepted_total', 'updated_by_user_id',
    'signer_contact_id', 'supersedes_proposal_id',
    'delivered_at', 'delivered_by_user_id'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Deletable statuses: draft (never sent) or superseded (replaced version).
    -- sent / viewed / accepted / declined / converted are part of the audit
    -- record — voided or reissued, never erased.
    IF OLD.status NOT IN ('draft', 'superseded') THEN
      RAISE EXCEPTION
        'Proposal % is % and part of the audit record — it cannot be deleted.',
        OLD.proposal_number, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- A superseded proposal may still carry a real (partial multi-signer)
    -- signature. proposal_acceptances is immutable and CASCADEs on delete, so
    -- deleting the parent would erase that signature. Refuse: audit material.
    IF OLD.status = 'superseded' AND EXISTS (
      SELECT 1 FROM public.proposal_acceptances pa
      WHERE pa.proposal_id = OLD.id
    ) THEN
      RAISE EXCEPTION
        'Proposal % has a recorded signature and cannot be deleted.',
        OLD.proposal_number
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(OLD) - mutable) = (to_jsonb(NEW) - mutable) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Proposal % was sent and its content is frozen. Create a new version to make changes.',
    OLD.proposal_number
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Widen the proposal_events enum for the two new lifecycle events:
--   delivered — the engagement was marked delivered by an owner/admin
--   reopened  — a delivered engagement was reopened (delivery undone)
-- Same DROP-then-ADD pattern as 20260720110000 (signoff_overridden).
-- db-parity.test.ts pins this to ALLOWED_PROPOSAL_EVENT_TYPES.
-- ============================================================
ALTER TABLE public.proposal_events
  DROP CONSTRAINT IF EXISTS proposal_events_event_type_check;

ALTER TABLE public.proposal_events
  ADD CONSTRAINT proposal_events_event_type_check
  CHECK (event_type IN
    ('created','sent','viewed','otp_sent','otp_verified','otp_failed',
     'accepted','declined','countersigned','converted','superseded',
     'link_resent','signoff_overridden','delivered','reopened'));
