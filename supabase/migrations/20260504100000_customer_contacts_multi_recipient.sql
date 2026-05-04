-- customer_contacts: allow multiple invoice recipients per customer.
--
-- The 2026-05-03 migration enforced "at most one is_invoice_recipient
-- per customer" via a partial unique index. Real-world need surfaced
-- the next day: a customer with two co-owners who both want to
-- receive invoices. Drop the constraint; the boolean stays as a
-- flag that contributes to the To: list, with no per-customer
-- cardinality limit.
--
-- Send-invoice path now joins every flagged contact's email into
-- the To: field (comma-separated). Falls back to customers.email
-- when no contact is flagged, preserving Phase-1 behavior for
-- single-recipient customers.

DROP INDEX IF EXISTS public.customer_contacts_one_invoice_recipient_per_customer;

COMMENT ON COLUMN public.customer_contacts.is_invoice_recipient IS
  'When true, this contact''s email is included in the default To: list for any invoice sent to the parent customer. Multiple recipients per customer are allowed; the send-invoice flow joins every flagged email.';
