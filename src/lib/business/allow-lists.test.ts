import { describe, it, expect } from "vitest";
import { ALLOWED_ENTITY_TYPES, ALLOWED_AFFILIATION_ROLES } from "./allow-lists";

// Constraint ↔ allow-list parity with the SQL CHECK constraints is
// enforced centrally by src/__tests__/db-parity.test.ts; this covers
// the membership semantics the business server actions rely on.
describe("ALLOWED_ENTITY_TYPES", () => {
  it("accepts every known entity type", () => {
    for (const t of [
      "sole_prop",
      "llc",
      "s_corp",
      "c_corp",
      "partnership",
      "nonprofit",
      "other",
    ]) {
      expect(ALLOWED_ENTITY_TYPES.has(t)).toBe(true);
    }
  });

  it("rejects unknown and near-miss values", () => {
    expect(ALLOWED_ENTITY_TYPES.has("LLC")).toBe(false);
    expect(ALLOWED_ENTITY_TYPES.has("")).toBe(false);
  });
});

describe("ALLOWED_AFFILIATION_ROLES", () => {
  it("accepts every known role", () => {
    for (const r of ["owner", "employee", "contractor", "partner"]) {
      expect(ALLOWED_AFFILIATION_ROLES.has(r)).toBe(true);
    }
  });

  it("rejects unknown roles", () => {
    expect(ALLOWED_AFFILIATION_ROLES.has("admin")).toBe(false);
  });
});
