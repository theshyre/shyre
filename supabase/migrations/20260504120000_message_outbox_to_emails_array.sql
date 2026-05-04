-- message_outbox.to_emails — structured array for the To: list.
--
-- Since multi-recipient landed (2026-05-03 customer_contacts +
-- multi-recipient migration), the To: column has been a comma-joined
-- string ("a@x.com, b@x.com"). Bookkeeper review caught this as an
-- audit-trail blocker: "who was on To: of INV-2026-143?" needs a
-- string-split-and-pray on a TEXT field, with no way to distinguish
-- a comma in an email's display name from a recipient separator.
--
-- This migration adds a TEXT[] column. The existing `to_email` TEXT
-- column stays — it's the legacy display field that other surfaces
-- still read; we backfill it from the array on writes for now and
-- can drop it in a follow-up after every reader migrates.
--
-- Backfill of existing rows: split the joined string on `, ` (the
-- exact separator the send path uses). Any row whose `to_email` was
-- a single recipient produces a single-element array. NULL stays
-- NULL.

ALTER TABLE public.message_outbox
  ADD COLUMN IF NOT EXISTS to_emails TEXT[];

UPDATE public.message_outbox
SET to_emails = string_to_array(to_email, ', ')
WHERE to_emails IS NULL
  AND to_email IS NOT NULL;

COMMENT ON COLUMN public.message_outbox.to_emails IS
  'Structured To: list. One element per recipient. The legacy `to_email` TEXT column is kept in sync (joined with ", ") for backwards compatibility but is being phased out — read this column, not the joined string.';
