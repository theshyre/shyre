-- Proposals lifecycle signals (system-review batch 4a).
--
-- 1. Realtime: proposals join the payload-free team broadcast (SAL-035
--    pattern). Proposal status changes are made by an EXTERNAL signer with no
--    page open on the author's side — exactly the background-edit case the
--    broadcast exists for. The trigger sends only the table name; the browser
--    refetches through RLS.
-- 2. `link_resent` joins the proposal_events CHECK — the new resend/rotate
--    action logs when outstanding sign links are revoked + re-issued, so the
--    audit trail explains why a signer holds a link that no longer works.
--    (Allow-list ALLOWED_PROPOSAL_EVENT_TYPES widens in the same PR;
--    db-parity.test.ts enforces the match.)

DROP TRIGGER IF EXISTS broadcast_change ON public.proposals;
CREATE TRIGGER broadcast_change
  AFTER INSERT OR UPDATE OR DELETE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_team_change();

ALTER TABLE public.proposal_events
  DROP CONSTRAINT IF EXISTS proposal_events_event_type_check;
ALTER TABLE public.proposal_events
  ADD CONSTRAINT proposal_events_event_type_check CHECK (
    event_type IN (
      'created', 'sent', 'viewed', 'otp_sent', 'otp_verified', 'otp_failed',
      'accepted', 'declined', 'countersigned', 'converted', 'superseded',
      'link_resent'
    )
  );
