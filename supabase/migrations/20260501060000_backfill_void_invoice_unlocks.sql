-- One-shot backfill: unlock time entries linked to currently-void
-- invoices.
--
-- The void-unlock trigger added in 20260501040000 fires on the
-- AFTER UPDATE OF status step, so it only handles future voids.
-- Any invoice that was voided before that trigger landed (e.g. the
-- user's draft they voided yesterday because they didn't realize a
-- preview was coming in the next deploy) still has its child
-- time_entries pointing at it with invoiced=true / invoice_id set.
-- The lock chip + the inline-edit guard would refuse the user's
-- edits indefinitely.
--
-- Sweep all currently-void invoices and run the same unlock the
-- trigger does. Idempotent — the trigger's own filter
-- (`invoice_id IN ...`) is the same predicate; running this twice
-- is a no-op on the second pass because the rows are already
-- detached. Wrapped in DO so the SECURITY DEFINER bypass on the
-- BEFORE UPDATE lock-guard isn't needed: the lock-guard accepts
-- the unlock-path mutation (clearing invoiced + invoice_id) when
-- the linked invoice's status is 'void', which it is for every
-- row this query touches.

UPDATE public.time_entries
SET invoiced = FALSE,
    invoice_id = NULL
WHERE invoice_id IS NOT NULL
  AND invoice_id IN (
    SELECT id FROM public.invoices WHERE status = 'void'
  );
