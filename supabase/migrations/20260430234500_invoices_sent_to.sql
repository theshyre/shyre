-- Track who an invoice was sent to.
--
-- The activity log surfaces an "Invoice sent" event from sent_at,
-- but Harvest's own log adds the recipient ("Sent invoice to Bret
-- Andre <bandre@fdapproval.com>"). We need somewhere to store that.
--
-- Two columns on `invoices` is the minimum viable shape: it captures
-- the most-recent recipient, which is what the user actually sees in
-- their email client when they re-send. Multi-send history (re-sends
-- creating a chronological list of recipients) is out of scope here
-- — a future invoice_messages table can layer on without disturbing
-- this schema.
--
-- Both columns are nullable: hand-created Shyre invoices that
-- haven't been sent yet, draft imports, and pre-existing rows all
-- coexist with NULL. Length caps mirror typical email + display
-- name limits with comfortable headroom.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sent_to_email TEXT,
  ADD COLUMN IF NOT EXISTS sent_to_name  TEXT;

COMMENT ON COLUMN public.invoices.sent_to_email IS
  'Most-recent recipient email this invoice was sent to. Populated '
  'by importers (e.g. Harvest) and any future "Send" action; NULL '
  'until the invoice is sent.';

COMMENT ON COLUMN public.invoices.sent_to_name IS
  'Display name paired with sent_to_email when known.';
