/**
 * Allow-list for team_settings.entity_type. Mirrored by a CHECK constraint
 * in 20260414220612_business_identity.sql. See src/__tests__/db-parity.test.ts.
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
