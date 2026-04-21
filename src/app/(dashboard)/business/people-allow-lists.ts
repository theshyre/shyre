/**
 * Allow-lists for business_people enums. Mirrored by CHECK constraints
 * in 20260420190000_business_people.sql. See src/__tests__/db-parity.test.ts.
 *
 * Column names are unique in the schema so the parity test's "last
 * CHECK wins" extractor resolves unambiguously.
 */

export const ALLOWED_EMPLOYMENT_TYPES = new Set([
  "w2_employee",
  "1099_contractor",
  "partner",
  "owner",
  "unpaid",
]);

export const ALLOWED_COMPENSATION_TYPES = new Set([
  "salary",
  "hourly",
  "project_based",
  "equity_only",
  "unpaid",
]);

export const ALLOWED_COMPENSATION_SCHEDULES = new Set([
  "annual",
  "monthly",
  "biweekly",
  "weekly",
  "per_hour",
  "per_project",
]);
