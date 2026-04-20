/**
 * Allow-list for businesses.entity_type. Mirrored by a CHECK constraint
 * in 20260420170000_introduce_businesses_and_affiliations.sql.
 * See src/__tests__/db-parity.test.ts.
 */
export const ALLOWED_ENTITY_TYPES = new Set([
  "sole_prop",
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "nonprofit",
  "other",
]);

/**
 * Allow-list for user_business_affiliations.role. Identity-of-employment —
 * not an authorization level (auth is derived from team_members). Mirrored
 * by a CHECK constraint in 20260420170000_introduce_businesses_and_affiliations.sql.
 */
export const ALLOWED_AFFILIATION_ROLES = new Set([
  "owner",
  "employee",
  "contractor",
  "partner",
]);
