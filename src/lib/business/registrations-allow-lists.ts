/**
 * Allow-lists for business_state_registrations, business_tax_registrations,
 * and business_registered_agents. Mirrored by CHECK constraints in
 * 20260420170002_business_registrations.sql. See src/__tests__/db-parity.test.ts.
 *
 * Each column name is unique across the schema so the parity test's
 * "last CHECK wins" extractor resolves unambiguously.
 */

export const ALLOWED_REGISTRATION_TYPES = new Set([
  "domestic",
  "foreign_qualification",
]);

export const ALLOWED_REGISTRATION_STATUSES = new Set([
  "pending",
  "active",
  "delinquent",
  "withdrawn",
  "revoked",
]);

export const ALLOWED_REPORT_FREQUENCIES = new Set([
  "annual",
  "biennial",
  "decennial",
]);

export const ALLOWED_DUE_RULES = new Set([
  "fixed_date",
  "anniversary",
  "quarter_end",
]);

export const ALLOWED_TAX_TYPES = new Set([
  "sales_use",
  "seller_use",
  "consumer_use",
  "gross_receipts",
]);

export const ALLOWED_TAX_REGISTRATION_STATUSES = new Set([
  "pending",
  "active",
  "delinquent",
  "closed",
]);

export const ALLOWED_FILING_FREQUENCIES = new Set([
  "monthly",
  "quarterly",
  "annual",
  "semi_annual",
]);
