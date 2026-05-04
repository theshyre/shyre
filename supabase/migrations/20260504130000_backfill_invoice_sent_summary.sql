-- Backfill: populate invoices.sent_to_email + sent_to_name on
-- invoices that have outbox-confirmed sends but null summary
-- columns.
--
-- Bug history: send-invoice-action.ts shipped without writing the
-- summary columns until 2026-05-04 (commit 5d6b409). Any invoice
-- sent through Shyre between Phase-1 messaging launch (2026-05-03)
-- and the action fix has rows in `message_outbox` with `sent_at`
-- set, but `invoices.sent_to_email` / `sent_to_name` are NULL.
--
-- The activity log handles those rows correctly (it reads from
-- message_outbox directly when present), but the summary columns
-- are still the right shape for SQL queries / future reports /
-- exports — leaving them NULL makes the column lie about a fact
-- the system knows.
--
-- Strategy: for each invoice with NULL sent_to_email but at least
-- one outbox row that delivered, copy the most-recent outbox row's
-- recipient list (joined) and the customer's name. Idempotent
-- (filtered by NULL).

WITH most_recent_send AS (
  SELECT DISTINCT ON (mo.related_id)
    mo.related_id AS invoice_id,
    -- Prefer the structured array (joined) when present; fall
    -- back to the legacy joined string for any row that landed
    -- before the to_emails column was added (paranoia — the
    -- prior backfill should have populated to_emails for every
    -- row already, but use COALESCE in case).
    COALESCE(
      array_to_string(mo.to_emails, ', '),
      mo.to_email
    ) AS recipient_string
  FROM public.message_outbox mo
  WHERE mo.related_kind = 'invoice'
    AND mo.related_id IS NOT NULL
    AND mo.sent_at IS NOT NULL
  ORDER BY mo.related_id, mo.sent_at DESC
)
UPDATE public.invoices i
SET
  sent_to_email = mrs.recipient_string,
  sent_to_name  = (
    SELECT c.name FROM public.customers c WHERE c.id = i.customer_id
  )
FROM most_recent_send mrs
WHERE i.id = mrs.invoice_id::uuid
  AND i.sent_to_email IS NULL
  AND mrs.recipient_string IS NOT NULL;
