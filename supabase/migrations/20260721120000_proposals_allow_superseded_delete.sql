-- Proposals: let a superseded version be deleted (align the DB guard with the
-- app-layer policy) — while protecting recorded signatures from a cascade.
--
-- Background. `isProposalDeletable()` (src/lib/proposals/allow-lists.ts), the
-- bulk-delete strip (PR #110), and deleteProposalAction all treat a proposal as
-- deletable while `draft` (pure staging, never sent) OR `superseded` (a replaced
-- version whose live successor carries the deal forward; `supersedes_proposal_id`
-- is ON DELETE SET NULL, so unlinking a chain node is safe). But the P2 send-lock
-- guard (20260716150000) still rejected the delete of ANY non-`draft` proposal —
-- so clearing out superseded test proposals raised check_violation (pgCode 23514)
-- in production even though every app layer allowed it. This reconciles the two.
--
-- Audit-integrity subtlety the app policy missed: `proposal_acceptances` is
-- immutable (no client INSERT/UPDATE/DELETE policies) but its proposal_id FK is
-- ON DELETE CASCADE. `superseded` is only reachable from draft/sent/viewed, and a
-- multi-signer proposal can hold a partial (e.g. 1-of-2) signature while still in
-- `sent`/`viewed`, then be superseded on revision — carrying a real acceptance
-- row into the superseded state. Deleting that parent would erase an immutable
-- signature through the FK back door. So the guard additionally refuses to delete
-- a superseded proposal that has any recorded acceptance: that one is audit
-- material and stays. Test proposals (never signed) have no acceptances and
-- delete freely.
--
-- CREATE OR REPLACE only — no schema change, additive/safe to ship with code in
-- one PR. The UPDATE branch (content freeze) is unchanged.

CREATE OR REPLACE FUNCTION public.tg_proposals_send_lock_guard()
RETURNS TRIGGER AS $$
DECLARE
  -- Columns that MAY change after a proposal leaves draft: lifecycle status +
  -- its trigger-stamped timestamps, the acceptance-computed total, actor
  -- stamps, and FK columns that referential actions (ON DELETE SET NULL) must
  -- be able to clear without tripping the lock. Everything else — title,
  -- terms, dates, customer — is frozen; a revision is a NEW version (P4).
  -- DEFAULT-DENY: columns added by future migrations are locked until
  -- deliberately added here (SAL-034 lesson).
  mutable CONSTANT text[] := ARRAY[
    'status', 'sent_at', 'viewed_at', 'accepted_at', 'declined_at',
    'converted_at', 'accepted_total', 'updated_by_user_id',
    'signer_contact_id', 'supersedes_proposal_id'
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
