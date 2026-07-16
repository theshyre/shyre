import { describe, it, expect } from "vitest";
import { proposalSchema } from "./proposal";

function baseInput(): Record<string, unknown> {
  return {
    team_id: "11111111-1111-4111-8111-111111111111",
    customer_id: "22222222-2222-4222-8222-222222222222",
    title: "Modernization work",
    deposit_type: "none",
    items: [
      { title: "Basic dependency upgrades", fixedPrice: 950 },
      {
        title: "Modernize underlying components",
        fixedPrice: 4000,
        isCapped: true,
        phases: [
          { title: "Update the visual framework", fixedPrice: 2200 },
          { title: "Retire older libraries", fixedPrice: 1200 },
          { title: "Refresh code-quality checks", fixedPrice: 600 },
        ],
      },
    ],
  };
}

function issuePaths(result: ReturnType<typeof proposalSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("proposalSchema", () => {
  it("accepts the kickoff example shape", () => {
    const result = proposalSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
  });

  it("requires title, team, and customer", () => {
    const result = proposalSchema.safeParse({
      ...baseInput(),
      title: "",
      team_id: "nope",
      customer_id: undefined,
    });
    expect(result.success).toBe(false);
    const paths = issuePaths(result);
    expect(paths).toContain("title");
    expect(paths).toContain("team_id");
    expect(paths).toContain("customer_id");
  });

  it("routes domain issues (phase-sum mismatch) into field paths", () => {
    const input = baseInput();
    (input.items as Array<{ phases?: unknown[] }>)[1]!.phases = [
      { title: "Only phase", fixedPrice: 100 },
    ];
    const result = proposalSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("items.1.phases");
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "items.1.phases",
      );
      expect(issue?.message).toBe("phaseSumMismatch");
    }
  });

  it("requires at least one item", () => {
    const result = proposalSchema.safeParse({ ...baseInput(), items: [] });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("items");
  });

  it("couples deposit_value to deposit_type", () => {
    const missing = proposalSchema.safeParse({
      ...baseInput(),
      deposit_type: "percent",
      deposit_value: null,
    });
    expect(issuePaths(missing)).toContain("deposit_value");

    const tooHigh = proposalSchema.safeParse({
      ...baseInput(),
      deposit_type: "percent",
      deposit_value: 150,
    });
    expect(issuePaths(tooHigh)).toContain("deposit_value");
    if (!tooHigh.success) {
      expect(
        tooHigh.error.issues.find((i) => i.path.join(".") === "deposit_value")
          ?.message,
      ).toBe("depositPercentTooHigh");
    }

    const flatOk = proposalSchema.safeParse({
      ...baseInput(),
      deposit_type: "amount",
      deposit_value: 500,
    });
    expect(flatOk.success).toBe(true);

    // `none` tolerates a stale value from the form state.
    const noneOk = proposalSchema.safeParse({
      ...baseInput(),
      deposit_type: "none",
      deposit_value: 500,
    });
    expect(noneOk.success).toBe(true);
  });

  it("bounds payment terms to 0..365", () => {
    const result = proposalSchema.safeParse({
      ...baseInput(),
      payment_terms_days: 400,
    });
    expect(issuePaths(result)).toContain("payment_terms_days");
    const ok = proposalSchema.safeParse({ ...baseInput(), payment_terms_days: 30 });
    expect(ok.success).toBe(true);
  });

  it("rejects a validity window ending before it starts", () => {
    const result = proposalSchema.safeParse({
      ...baseInput(),
      issued_date: "2026-07-16",
      valid_until: "2026-07-01",
    });
    expect(issuePaths(result)).toContain("valid_until");
    const ok = proposalSchema.safeParse({
      ...baseInput(),
      issued_date: "2026-07-16",
      valid_until: "2026-08-15",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects malformed dates", () => {
    const result = proposalSchema.safeParse({
      ...baseInput(),
      valid_until: "July 16",
    });
    expect(issuePaths(result)).toContain("valid_until");
  });
});
