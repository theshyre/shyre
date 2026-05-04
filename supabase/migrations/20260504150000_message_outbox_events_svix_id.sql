-- Webhook deduplication via svix-id.
--
-- Resend (via svix) retries webhook delivery on 5xx. The handler
-- today is partially idempotent — recordEvent inserts a fresh
-- events row on every retry, and flagCustomerBounce overwrites
-- bounced_at/complained_at with the latest call. The double-insert
-- creates noise in the activity log; the overwrite isn't a bug
-- (timestamp slides forward) but does mean a customer flagged on
-- the first delivery gets re-flagged with a slightly later
-- timestamp on the retry.
--
-- Standard-Webhooks practice: dedupe on `svix-id`. The header
-- value is unique per logical webhook delivery; svix retries
-- carry the same id. Adding a column + unique index lets the
-- handler drop the second insert with ON CONFLICT DO NOTHING.

ALTER TABLE public.message_outbox_events
  ADD COLUMN IF NOT EXISTS svix_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_outbox_events_svix_id
  ON public.message_outbox_events (svix_id)
  WHERE svix_id IS NOT NULL;

COMMENT ON COLUMN public.message_outbox_events.svix_id IS
  'Header svix-id from the inbound webhook delivery. Unique within the table; Standard-Webhooks practice for idempotent retry handling. NULL allowed for backfill / non-svix sources.';
