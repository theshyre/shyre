import { describe, it, expect } from "vitest";
import { ALLOWED_EXPENSE_CATEGORIES } from "./allow-lists";

// Constraint ↔ allow-list parity with the SQL CHECK constraint is
// enforced centrally by src/__tests__/db-parity.test.ts; this test
// covers the membership semantics server actions rely on.
describe("ALLOWED_EXPENSE_CATEGORIES", () => {
  it("accepts every known category", () => {
    for (const c of [
      "software",
      "hardware",
      "subscriptions",
      "travel",
      "meals",
      "office",
      "professional_services",
      "fees",
      "other",
    ]) {
      expect(ALLOWED_EXPENSE_CATEGORIES.has(c)).toBe(true);
    }
  });

  it("rejects unknown and near-miss values", () => {
    expect(ALLOWED_EXPENSE_CATEGORIES.has("Software")).toBe(false);
    expect(ALLOWED_EXPENSE_CATEGORIES.has("professional services")).toBe(
      false,
    );
    expect(ALLOWED_EXPENSE_CATEGORIES.has("")).toBe(false);
  });
});
