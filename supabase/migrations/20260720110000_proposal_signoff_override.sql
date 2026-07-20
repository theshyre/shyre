-- Sign-off override (Marcus 2026-07-20): a multi-signer ('all' mode)
-- proposal can be completed by an owner/admin when a co-signer will
-- never sign — the deal moved on. The override is an audited event
-- (required note, actor, waived signers in metadata), never a silent
-- status edit: the activity trail and the Sign-off block both surface
-- it. Widen the proposal_events CHECK for the new event type; same
-- pattern as 20260717220000 (link_resent).

ALTER TABLE public.proposal_events
  DROP CONSTRAINT IF EXISTS proposal_events_event_type_check;

ALTER TABLE public.proposal_events
  ADD CONSTRAINT proposal_events_event_type_check
  CHECK (event_type IN
    ('created','sent','viewed','otp_sent','otp_verified','otp_failed',
     'accepted','declined','countersigned','converted','superseded',
     'link_resent','signoff_overridden'));
