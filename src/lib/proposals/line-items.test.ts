import { describe, it, expect } from "vitest";
import {
  roundMoney,
  phaseSum,
  proposalTotal,
  selectedTotal,
  validateProposalItems,
  MAX_MONEY,
  type ProposalItemInput,
} from "./line-items";

/** The concrete example the feature is built around (kickoff spec). */
function exampleItems(): ProposalItemInput[] {
  return [
    { title: "Basic dependency upgrades", fixedPrice: 950 },
    { title: "Replace the Gen 1→Gen 2 compatibility layer", fixedPrice: 2500 },
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
  ];
}

describe("money math", () => {
  it("rounds to cents with the invoice-utils convention (Math.round(x*100)/100)", () => {
    expect(roundMoney(1.239)).toBe(1.24);
    expect(roundMoney(2.004)).toBe(2.0);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3); // float noise collapses
    expect(roundMoney(0)).toBe(0);
    // IEEE754: 1.005 is stored as 1.00499…, so it rounds DOWN — matching
    // calculateLineItemAmount exactly. Consistency with the invoice money
    // model matters more than textbook half-up.
    expect(roundMoney(1.005)).toBe(1.0);
  });

  it("sums phases with per-unit rounding", () => {
    expect(phaseSum(exampleItems()[2]!)).toBe(4000);
    expect(phaseSum({ title: "x", fixedPrice: 0.03, phases: [
      { title: "a", fixedPrice: 0.015 },
      { title: "b", fixedPrice: 0.015 },
    ] })).toBe(0.04); // each phase rounds to 0.02 first — invoice convention
  });

  it("proposalTotal sums top-level items only (phases are a breakdown)", () => {
    expect(proposalTotal(exampleItems())).toBe(7450);
  });

  it("selectedTotal computes the accepted subset — P1+P3 = $4,950", () => {
    expect(selectedTotal(exampleItems(), [0, 2])).toBe(4950);
    expect(selectedTotal(exampleItems(), [])).toBe(0);
    expect(selectedTotal(exampleItems(), [0, 1, 2])).toBe(7450);
    // out-of-range indexes are ignored, and duplicates don't double-count
    expect(selectedTotal(exampleItems(), [0, 0, 9])).toBe(950);
  });
});

describe("validateProposalItems", () => {
  it("accepts the kickoff example", () => {
    expect(validateProposalItems(exampleItems())).toEqual([]);
  });

  it("requires at least one item", () => {
    expect(validateProposalItems([])).toEqual([
      { path: "items", key: "itemsRequired" },
    ]);
  });

  it("flags blank titles on items and phases", () => {
    const issues = validateProposalItems([
      { title: "  ", fixedPrice: 100 },
      { title: "ok", fixedPrice: 100, phases: [{ title: "", fixedPrice: 100 }] },
    ]);
    expect(issues).toContainEqual({ path: "items.0.title", key: "titleRequired" });
    expect(issues).toContainEqual({
      path: "items.1.phases.0.title",
      key: "titleRequired",
    });
  });

  it("rejects negative, non-finite, and out-of-range prices", () => {
    const issues = validateProposalItems([
      { title: "neg", fixedPrice: -1 },
      { title: "nan", fixedPrice: Number.NaN },
      { title: "big", fixedPrice: MAX_MONEY + 1 },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "items.0.fixedPrice",
      "items.1.fixedPrice",
      "items.2.fixedPrice",
    ]);
    expect(new Set(issues.map((i) => i.key))).toEqual(new Set(["priceInvalid"]));
  });

  it("rejects a phased item whose phases don't sum to the item price", () => {
    const issues = validateProposalItems([
      {
        title: "phased",
        fixedPrice: 4000,
        phases: [
          { title: "a", fixedPrice: 2200 },
          { title: "b", fixedPrice: 1200 },
          // missing $600 phase
        ],
      },
    ]);
    expect(issues).toEqual([
      {
        path: "items.0.phases",
        key: "phaseSumMismatch",
        params: { expected: 4000, actual: 3400 },
      },
    ]);
  });

  it("does not double-report a phase-sum mismatch when the parent price is itself invalid", () => {
    const issues = validateProposalItems([
      { title: "x", fixedPrice: -5, phases: [{ title: "a", fixedPrice: 10 }] },
    ]);
    expect(issues).toEqual([{ path: "items.0.fixedPrice", key: "priceInvalid" }]);
  });

  it("accepts an unphased item at zero and at the max bound", () => {
    expect(
      validateProposalItems([
        { title: "free", fixedPrice: 0 },
        { title: "max", fixedPrice: MAX_MONEY },
      ]),
    ).toEqual([]);
  });
});
