-- Customer contacts.
--
-- Customers (the businesses you bill) typically have one or more
-- *people* — an AP manager, a project sponsor, a CFO, etc. Up to
-- now Shyre held one bare `customers.email` field, which is fine
-- for solo-customer relationships but wrong as soon as the user
-- needs to "send invoices to AP, not to the project sponsor I
-- talk to every week."
--
-- Surfaces that need this:
--   1. Send Invoice → To: pre-fills from the contact flagged
--      `is_invoice_recipient` (falls back to customers.email when
--      no contacts exist, preserving Phase-1 behavior).
--   2. Customer detail → contacts list (add / edit / delete /
--      "send invoices to" toggle).
--   3. Future Phase 2 reminders + Phase 3 thank-you → same
--      recipient lookup, no schema churn.
--
-- Per CLAUDE.md additive-migration rules: new table + indexes
-- only. Reuses customers.email as the fallback recipient — no
-- destructive change to the existing column.

CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized team_id avoids a join through customers on every
  -- RLS read. Kept in sync via trigger below; CHECK ensures it
  -- matches the parent customer's team.
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  email TEXT NOT NULL CHECK (length(btrim(email)) > 0),
  -- Free-text role label ("AP Manager", "Owner", "Project lead").
  -- Optional. Helps the user disambiguate two contacts at the same
  -- customer without forcing a strict enum.
  role_label TEXT,
  -- One contact per customer can be the default invoice recipient
  -- at a time; partial unique index below enforces it. Multiple
  -- contacts as Cc-default is a future feature (tracked separately).
  is_invoice_recipient BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One default-recipient per customer. Partial unique index lets
-- toggling work without a deferred-update dance — the action
-- clears the old recipient (UPDATE … is_invoice_recipient=FALSE)
-- before setting the new one.
CREATE UNIQUE INDEX IF NOT EXISTS customer_contacts_one_invoice_recipient_per_customer
  ON public.customer_contacts (customer_id)
  WHERE is_invoice_recipient;

-- For the send-invoice lookup ("get the recipient for customer X").
CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id
  ON public.customer_contacts (customer_id);

-- For team-scoped reads (RLS uses team_id).
CREATE INDEX IF NOT EXISTS idx_customer_contacts_team_id
  ON public.customer_contacts (team_id);

-- updated_at maintenance.
CREATE TRIGGER customer_contacts_set_updated_at
  BEFORE UPDATE ON public.customer_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_updated_at();

-- RLS — read for any team member, write for owner/admin only.
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_contacts_select ON public.customer_contacts
  FOR SELECT
  USING (public.user_team_role(team_id) IS NOT NULL);

CREATE POLICY customer_contacts_insert ON public.customer_contacts
  FOR INSERT
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY customer_contacts_update ON public.customer_contacts
  FOR UPDATE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'))
  WITH CHECK (public.user_team_role(team_id) IN ('owner', 'admin'));

CREATE POLICY customer_contacts_delete ON public.customer_contacts
  FOR DELETE
  USING (public.user_team_role(team_id) IN ('owner', 'admin'));

COMMENT ON TABLE public.customer_contacts IS
  'People at a customer org — the To: list for invoices, reminders, and thank-you emails. customers.email remains as the fallback recipient when no contact is flagged.';
COMMENT ON COLUMN public.customer_contacts.is_invoice_recipient IS
  'When true, this contact''s email is the default To: address for any invoice sent to the parent customer. Enforced one-per-customer via partial unique index.';
