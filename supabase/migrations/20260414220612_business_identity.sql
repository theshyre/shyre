-- Business identity fields on organization_settings (Business module MVP)
--
-- Extends the existing per-org settings with the data needed to describe
-- the legal business entity: registration jurisdiction, tax IDs, entity
-- form, incorporation date, fiscal year start. All nullable — a brand-new
-- org has no legal-identity data until the user fills it in.
--
-- No separate business_identity table: each org is the business. Adding
-- columns to organization_settings keeps everything discoverable via
-- the existing user_settings / organization_settings split.

ALTER TABLE organization_settings
  ADD COLUMN legal_name TEXT,
  ADD COLUMN entity_type TEXT
    CHECK (entity_type IS NULL OR entity_type IN (
      'sole_prop', 'llc', 's_corp', 'c_corp', 'partnership', 'nonprofit', 'other'
    )),
  ADD COLUMN tax_id TEXT,
  ADD COLUMN state_registration_id TEXT,
  ADD COLUMN registered_state TEXT,
  ADD COLUMN date_incorporated DATE,
  ADD COLUMN fiscal_year_start TEXT
    CHECK (fiscal_year_start IS NULL OR fiscal_year_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

COMMENT ON COLUMN organization_settings.legal_name IS 'Registered legal name if different from business_name';
COMMENT ON COLUMN organization_settings.entity_type IS 'sole_prop|llc|s_corp|c_corp|partnership|nonprofit|other';
COMMENT ON COLUMN organization_settings.tax_id IS 'EIN (US) or equivalent tax identifier';
COMMENT ON COLUMN organization_settings.state_registration_id IS 'State filing ID (varies by jurisdiction)';
COMMENT ON COLUMN organization_settings.registered_state IS 'State/province/region of registration (free text; e.g. CA, Delaware)';
COMMENT ON COLUMN organization_settings.date_incorporated IS 'Formation date';
COMMENT ON COLUMN organization_settings.fiscal_year_start IS 'MM-DD — e.g. 01-01 for calendar, 07-01 for July fiscal year';
