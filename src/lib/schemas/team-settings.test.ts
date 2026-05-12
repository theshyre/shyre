import { describe, it, expect } from "vitest";
import { teamSettingsSchema } from "./team-settings";

const validBase = {
  team_id: "11111111-1111-4111-8111-111111111111",
};

describe("teamSettingsSchema", () => {
  it("accepts the minimum valid payload (team_id only) and applies defaults", () => {
    const r = teamSettingsSchema.safeParse(validBase);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.invoice_prefix).toBe("INV");
      expect(r.data.invoice_next_num).toBe(1);
      expect(r.data.default_rate).toBe(0);
      expect(r.data.tax_rate).toBe(0);
    }
  });

  it("rejects an invalid team_id", () => {
    const r = teamSettingsSchema.safeParse({ team_id: "nope" });
    expect(r.success).toBe(false);
  });

  it("accepts empty business_email (form ergonomic)", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      business_email: "",
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed business_email", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      business_email: "@@invalid",
    });
    expect(r.success).toBe(false);
  });

  it("rejects tax_rate > 100", () => {
    const r = teamSettingsSchema.safeParse({ ...validBase, tax_rate: 101 });
    expect(r.success).toBe(false);
  });

  it("rejects negative tax_rate", () => {
    const r = teamSettingsSchema.safeParse({ ...validBase, tax_rate: -0.5 });
    expect(r.success).toBe(false);
  });

  it("rejects default_rate > 10000", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      default_rate: 10001,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invoice_prefix > 10 chars", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      invoice_prefix: "TOOLONGGGGG",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty invoice_prefix", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      invoice_prefix: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invoice_next_num < 1", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      invoice_next_num: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-integer invoice_next_num", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      invoice_next_num: 1.5,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid hex brand_color (#RGB)", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      brand_color: "#abc",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a valid hex brand_color (#RRGGBB)", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      brand_color: "#7BAE5F",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-hex brand_color", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      brand_color: "rebeccapurple",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a hex brand_color without a #", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      brand_color: "7BAE5F",
    });
    expect(r.success).toBe(false);
  });

  it("accepts empty brand_color (form ergonomic)", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      brand_color: "",
    });
    expect(r.success).toBe(true);
  });

  it("rejects business_phone over 30 chars", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      business_phone: "+1 (555) 0123-4567 ext 999 long",
    });
    expect(r.success).toBe(false);
  });

  it("rejects wordmark over 50 chars", () => {
    const r = teamSettingsSchema.safeParse({
      ...validBase,
      wordmark_primary: "x".repeat(51),
    });
    expect(r.success).toBe(false);
  });
});
