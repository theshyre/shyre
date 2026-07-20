-- Audit batch C: widen message_outbox.related_kind so team-invite
-- accept-link emails ride the existing outbox pipeline (same
-- config → validate → quota → enqueue → drain path invoices and
-- proposals already use). See src/lib/messaging/send-team-invite.ts.
--
-- Additive; timestamp sorts after 20260720110000.

ALTER TABLE public.message_outbox
  DROP CONSTRAINT IF EXISTS message_outbox_related_kind_check;
ALTER TABLE public.message_outbox
  ADD CONSTRAINT message_outbox_related_kind_check
  CHECK (related_kind IN ('invoice', 'invoice_reminder', 'payment_thanks', 'proposal', 'proposal_otp', 'team_invite'));
