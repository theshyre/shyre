import { describe, it, expect } from "vitest";
import {
  ALLOWED_EMPLOYMENT_TYPES,
  ALLOWED_COMPENSATION_TYPES,
  ALLOWED_COMPENSATION_SCHEDULES,
} from "./people-allow-lists";

// Constraint ↔ allow-list parity with the SQL CHECK constraints is
// enforced centrally by src/__tests__/db-parity.test.ts; this covers
// the membership semantics the people form-parse helpers rely on.
describe("ALLOWED_EMPLOYMENT_TYPES", () => {
  it("accepts every known employment type", () => {
    for (const t of [
      "w2_employee",
      "1099_contractor",
      "partner",
      "owner",
      "unpaid",
    ]) {
      expect(ALLOWED_EMPLOYMENT_TYPES.has(t)).toBe(true);
    }
    expect(ALLOWED_EMPLOYMENT_TYPES.has("intern")).toBe(false);
  });
});

describe("ALLOWED_COMPENSATION_TYPES", () => {
  it("accepts every known compensation type", () => {
    for (const t of [
      "salary",
      "hourly",
      "project_based",
      "equity_only",
      "unpaid",
    ]) {
      expect(ALLOWED_COMPENSATION_TYPES.has(t)).toBe(true);
    }
    expect(ALLOWED_COMPENSATION_TYPES.has("commission")).toBe(false);
  });
});

describe("ALLOWED_COMPENSATION_SCHEDULES", () => {
  it("accepts every known schedule", () => {
    for (const s of [
      "annual",
      "monthly",
      "biweekly",
      "weekly",
      "per_hour",
      "per_project",
    ]) {
      expect(ALLOWED_COMPENSATION_SCHEDULES.has(s)).toBe(true);
    }
    expect(ALLOWED_COMPENSATION_SCHEDULES.has("daily")).toBe(false);
  });
});
