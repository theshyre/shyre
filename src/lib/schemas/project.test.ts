import { describe, it, expect } from "vitest";
import { projectSchema } from "./project";

const validBase = {
  name: "Atlas redesign",
  team_id: "11111111-1111-4111-8111-111111111111",
};

describe("projectSchema", () => {
  it("accepts the minimum valid payload", () => {
    const r = projectSchema.safeParse(validBase);
    expect(r.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const r = projectSchema.safeParse({ ...validBase, name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid team_id", () => {
    const r = projectSchema.safeParse({ ...validBase, team_id: "nope" });
    expect(r.success).toBe(false);
  });

  it("accepts customer_id=null (internal-project shape)", () => {
    const r = projectSchema.safeParse({ ...validBase, customer_id: null });
    expect(r.success).toBe(true);
  });

  it("accepts a valid customer_id UUID", () => {
    const r = projectSchema.safeParse({
      ...validBase,
      customer_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-UUID customer_id", () => {
    const r = projectSchema.safeParse({
      ...validBase,
      customer_id: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("accepts empty-string github_repo (form ergonomic)", () => {
    const r = projectSchema.safeParse({ ...validBase, github_repo: "" });
    expect(r.success).toBe(true);
  });

  it("accepts valid owner/repo github_repo", () => {
    const r = projectSchema.safeParse({
      ...validBase,
      github_repo: "vercel/next.js",
    });
    expect(r.success).toBe(true);
  });

  it("rejects github_repo without a slash", () => {
    const r = projectSchema.safeParse({
      ...validBase,
      github_repo: "missingslash",
    });
    expect(r.success).toBe(false);
  });

  it("rejects github_repo with two slashes", () => {
    const r = projectSchema.safeParse({
      ...validBase,
      github_repo: "owner/repo/extra",
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative hourly_rate", () => {
    const r = projectSchema.safeParse({ ...validBase, hourly_rate: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects hourly_rate > 10000", () => {
    const r = projectSchema.safeParse({ ...validBase, hourly_rate: 10001 });
    expect(r.success).toBe(false);
  });

  it("accepts hourly_rate=null (no rate set)", () => {
    const r = projectSchema.safeParse({ ...validBase, hourly_rate: null });
    expect(r.success).toBe(true);
  });

  it("rejects negative budget_hours", () => {
    const r = projectSchema.safeParse({ ...validBase, budget_hours: -10 });
    expect(r.success).toBe(false);
  });

  it("rejects description over 2000 chars", () => {
    const r = projectSchema.safeParse({
      ...validBase,
      description: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });
});
