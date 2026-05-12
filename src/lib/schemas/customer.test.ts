import { describe, it, expect } from "vitest";
import { customerSchema } from "./customer";

const validBase = {
  name: "Acme Corp",
  team_id: "11111111-1111-4111-8111-111111111111",
};

describe("customerSchema", () => {
  it("accepts the minimum valid payload (name + team_id)", () => {
    const r = customerSchema.safeParse(validBase);
    expect(r.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const r = customerSchema.safeParse({ ...validBase, name: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "name")).toBe(true);
    }
  });

  it("rejects a name over 200 chars", () => {
    const r = customerSchema.safeParse({
      ...validBase,
      name: "a".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid team_id (not a UUID)", () => {
    const r = customerSchema.safeParse({ ...validBase, team_id: "nope" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "team_id")).toBe(true);
    }
  });

  it("accepts an empty string for the optional email (form-input ergonomic)", () => {
    const r = customerSchema.safeParse({ ...validBase, email: "" });
    expect(r.success).toBe(true);
  });

  it("accepts a valid email", () => {
    const r = customerSchema.safeParse({
      ...validBase,
      email: "billing@acme.test",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const r = customerSchema.safeParse({ ...validBase, email: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("accepts default_rate=null (explicit no-rate)", () => {
    const r = customerSchema.safeParse({ ...validBase, default_rate: null });
    expect(r.success).toBe(true);
  });

  it("rejects a negative default_rate", () => {
    const r = customerSchema.safeParse({ ...validBase, default_rate: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects an unreasonably large default_rate (> 10000)", () => {
    const r = customerSchema.safeParse({ ...validBase, default_rate: 10001 });
    expect(r.success).toBe(false);
  });

  it("rejects notes over 2000 chars", () => {
    const r = customerSchema.safeParse({
      ...validBase,
      notes: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });
});
