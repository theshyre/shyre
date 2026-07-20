import { describe, it, expect } from "vitest";
import {
  ALLOWED_REGISTRATION_TYPES,
  ALLOWED_REGISTRATION_STATUSES,
  ALLOWED_REPORT_FREQUENCIES,
  ALLOWED_DUE_RULES,
  ALLOWED_TAX_TYPES,
  ALLOWED_TAX_REGISTRATION_STATUSES,
  ALLOWED_FILING_FREQUENCIES,
} from "./registrations-allow-lists";

// Constraint ↔ allow-list parity with the SQL CHECK constraints is
// enforced centrally by src/__tests__/db-parity.test.ts; this covers
// the membership semantics the registrations form-parse helpers rely on.
describe("ALLOWED_REGISTRATION_TYPES", () => {
  it("accepts domestic and foreign_qualification only", () => {
    expect(ALLOWED_REGISTRATION_TYPES.has("domestic")).toBe(true);
    expect(ALLOWED_REGISTRATION_TYPES.has("foreign_qualification")).toBe(
      true,
    );
    expect(ALLOWED_REGISTRATION_TYPES.has("international")).toBe(false);
  });
});

describe("ALLOWED_REGISTRATION_STATUSES", () => {
  it("accepts every known status", () => {
    for (const s of [
      "pending",
      "active",
      "delinquent",
      "withdrawn",
      "revoked",
    ]) {
      expect(ALLOWED_REGISTRATION_STATUSES.has(s)).toBe(true);
    }
    expect(ALLOWED_REGISTRATION_STATUSES.has("expired")).toBe(false);
  });
});

describe("ALLOWED_REPORT_FREQUENCIES", () => {
  it("accepts annual, biennial, decennial", () => {
    for (const f of ["annual", "biennial", "decennial"]) {
      expect(ALLOWED_REPORT_FREQUENCIES.has(f)).toBe(true);
    }
    expect(ALLOWED_REPORT_FREQUENCIES.has("monthly")).toBe(false);
  });
});

describe("ALLOWED_DUE_RULES", () => {
  it("accepts fixed_date, anniversary, quarter_end", () => {
    for (const r of ["fixed_date", "anniversary", "quarter_end"]) {
      expect(ALLOWED_DUE_RULES.has(r)).toBe(true);
    }
    expect(ALLOWED_DUE_RULES.has("year_end")).toBe(false);
  });
});

describe("ALLOWED_TAX_TYPES", () => {
  it("accepts every known tax type", () => {
    for (const t of [
      "sales_use",
      "seller_use",
      "consumer_use",
      "gross_receipts",
    ]) {
      expect(ALLOWED_TAX_TYPES.has(t)).toBe(true);
    }
    expect(ALLOWED_TAX_TYPES.has("income")).toBe(false);
  });
});

describe("ALLOWED_TAX_REGISTRATION_STATUSES", () => {
  it("accepts pending, active, delinquent, closed", () => {
    for (const s of ["pending", "active", "delinquent", "closed"]) {
      expect(ALLOWED_TAX_REGISTRATION_STATUSES.has(s)).toBe(true);
    }
    expect(ALLOWED_TAX_REGISTRATION_STATUSES.has("revoked")).toBe(false);
  });
});

describe("ALLOWED_FILING_FREQUENCIES", () => {
  it("accepts monthly, quarterly, annual, semi_annual", () => {
    for (const f of ["monthly", "quarterly", "annual", "semi_annual"]) {
      expect(ALLOWED_FILING_FREQUENCIES.has(f)).toBe(true);
    }
    expect(ALLOWED_FILING_FREQUENCIES.has("biweekly")).toBe(false);
  });
});
