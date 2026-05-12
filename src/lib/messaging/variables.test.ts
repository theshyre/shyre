import { describe, it, expect } from "vitest";
import { TEMPLATE_VARIABLES } from "./variables";

describe("TEMPLATE_VARIABLES catalog", () => {
  it("has at least one variable", () => {
    expect(TEMPLATE_VARIABLES.length).toBeGreaterThan(0);
  });

  it("every variable has a non-empty key, label, and description", () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(v.key).toMatch(/\S/);
      expect(v.label).toMatch(/\S/);
      expect(v.description).toMatch(/\S/);
    }
  });

  it("variable keys are unique", () => {
    const keys = TEMPLATE_VARIABLES.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every variable applies to at least one kind", () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(v.kinds.length).toBeGreaterThan(0);
    }
  });

  it("every kind value is one of the three documented kinds", () => {
    const allowed = new Set(["invoice_send", "invoice_reminder", "payment_thanks"]);
    for (const v of TEMPLATE_VARIABLES) {
      for (const k of v.kinds) {
        expect(allowed.has(k)).toBe(true);
      }
    }
  });

  it("days_past_due is reminder-only", () => {
    const v = TEMPLATE_VARIABLES.find((x) => x.key === "days_past_due");
    expect(v).toBeDefined();
    expect(Array.from(v!.kinds)).toEqual(["invoice_reminder"]);
  });

  it("days_until_due is reminder-only", () => {
    const v = TEMPLATE_VARIABLES.find((x) => x.key === "days_until_due");
    expect(v).toBeDefined();
    expect(Array.from(v!.kinds)).toEqual(["invoice_reminder"]);
  });

  it("invoice_id applies to all three kinds (used everywhere)", () => {
    const v = TEMPLATE_VARIABLES.find((x) => x.key === "invoice_id");
    expect(v).toBeDefined();
    expect(v!.kinds).toContain("invoice_send");
    expect(v!.kinds).toContain("invoice_reminder");
    expect(v!.kinds).toContain("payment_thanks");
  });

  it("does NOT expose invoice_url (Phase 1.5 — see source comment)", () => {
    expect(TEMPLATE_VARIABLES.some((v) => v.key === "invoice_url")).toBe(false);
  });
});
