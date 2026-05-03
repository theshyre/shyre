-- Invoice layout: project invoice_code + per-address country toggles.
--
-- Three additions for the PDF / web-detail rewrite:
--
--   1. projects.invoice_code  — short uppercase prefix that renders
--      on each line item ("[PC-ITOPS] Infrastructure & Systems …").
--      Optional. Distinct from `jira_project_key` because the Jira
--      key validator forbids hyphens (and because invoice prefixes
--      are an invoicing concern, not a ticket-tracker concern).
--      Regex `^[A-Z][A-Z0-9-]{1,15}$` mirrors what most accounting
--      packages accept as a "code" / "short name."
--
--   2. team_settings.show_country_on_invoice  — toggles the country
--      line under the team's address on the From block.
--   3. customers.show_country_on_invoice      — same toggle for the
--      Invoice For block.
--
-- These are independent decisions: a US team invoicing a UK client
-- suppresses From's country (the customer already knows the team is
-- domestic), but shows the customer's. Default is OFF on both, since
-- ~90% of invoices are domestic and the country line is usually
-- noise.
--
-- Both team_settings_v and customers_v need the new columns. Postgres
-- refuses CREATE OR REPLACE when adding columns mid-list, so drop +
-- recreate matches the prior view-update playbook.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS invoice_code TEXT
    CHECK (invoice_code IS NULL
           OR invoice_code ~ '^[A-Z][A-Z0-9-]{1,15}$');

COMMENT ON COLUMN public.projects.invoice_code IS
  'Short uppercase prefix rendered as "[<code>]" on invoice line items. Optional. Independent of jira_project_key (which is hyphen-free by Atlassian convention).';

ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS show_country_on_invoice BOOLEAN
    NOT NULL DEFAULT false;

COMMENT ON COLUMN public.team_settings.show_country_on_invoice IS
  'When true, render the country line under the team''s address on the invoice From block. Default false — most invoices are domestic and the country reads as noise.';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS show_country_on_invoice BOOLEAN
    NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.show_country_on_invoice IS
  'When true, render the country line under the customer''s address on the invoice Invoice For block. Default false. Independent of the team-side toggle.';

DROP VIEW IF EXISTS public.team_settings_v;

CREATE VIEW public.team_settings_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  ts.team_id,
  ts.business_name,
  ts.business_email,
  ts.business_address,
  ts.business_phone,
  ts.logo_url,
  CASE WHEN public.can_view_team_rate(ts.team_id) THEN ts.default_rate ELSE NULL END AS default_rate,
  ts.invoice_prefix,
  ts.invoice_next_num,
  ts.tax_rate,
  ts.wordmark_primary,
  ts.wordmark_secondary,
  ts.brand_color,
  ts.default_payment_terms_days,
  ts.show_country_on_invoice,
  ts.created_at,
  ts.updated_at,
  ts.rate_visibility,
  ts.rate_editability
FROM public.team_settings ts;

DROP VIEW IF EXISTS public.customers_v;

CREATE VIEW public.customers_v
  WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  c.id,
  c.user_id,
  c.name,
  c.email,
  c.address,
  c.notes,
  CASE WHEN public.can_view_customer_rate(c.id) THEN c.default_rate ELSE NULL END AS default_rate,
  c.payment_terms_days,
  c.show_country_on_invoice,
  c.created_at,
  c.archived,
  c.team_id,
  c.is_sample,
  c.rate_visibility,
  c.rate_editability
FROM public.customers c;
