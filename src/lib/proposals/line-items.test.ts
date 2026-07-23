import { describe, it, expect } from "vitest";
import {
  roundMoney,
  phaseSum,
  proposalTotal,
  selectedTotal,
  validateProposalItems,
  deriveAnchorAmount,
  itemPriceDisplay,
  buildProposalItemTree,
  isHomogeneousFixedBid,
  PROPOSAL_ITEM_COLUMNS,
  MAX_MONEY,
  type ProposalItemInput,
  type ProposalItemDbRow,
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

describe("buildProposalItemTree", () => {
  function dbRow(overrides: Partial<ProposalItemDbRow>): ProposalItemDbRow {
    return {
      id: "row-x",
      parent_line_item_id: null,
      sort_order: 0,
      title: "Untitled",
      summary: null,
      body_markdown: null,
      description: null,
      why_it_matters: null,
      out_of_scope: null,
      definition_of_done: null,
      fixed_price: 0,
      is_capped: false,
      pricing_type: "fixed_bid",
      hourly_rate: null,
      estimate_low: null,
      estimate_high: null,
      estimated_hours: null,
      ...overrides,
    };
  }

  it("keeps top-level items in row order and drops nothing", () => {
    const tree = buildProposalItemTree([
      dbRow({ id: "b", sort_order: 0, title: "First" }),
      dbRow({ id: "a", sort_order: 1, title: "Second" }),
    ]);
    // Row order (the caller orders by sort_order) wins — not id order.
    expect(tree.map((n) => n.id)).toEqual(["b", "a"]);
    expect(tree.map((n) => n.title)).toEqual(["First", "Second"]);
  });

  it("nests each phase under its parent, in row order, and excludes it from the top level", () => {
    const tree = buildProposalItemTree([
      dbRow({ id: "p1", title: "Phased", fixed_price: 4000, is_capped: true }),
      dbRow({ id: "p2", title: "Flat", fixed_price: 950 }),
      dbRow({
        id: "c1",
        parent_line_item_id: "p1",
        title: "Phase A",
        description: "first",
        fixed_price: 2500,
      }),
      dbRow({
        id: "c2",
        parent_line_item_id: "p1",
        title: "Phase B",
        fixed_price: 1500,
      }),
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.isCapped).toBe(true);
    expect(tree[0]?.phases).toEqual([
      { title: "Phase A", description: "first", fixedPrice: 2500 },
      { title: "Phase B", description: null, fixedPrice: 1500 },
    ]);
    expect(tree[1]?.phases).toEqual([]);
  });

  it("coerces NUMERIC string prices to numbers on items and phases", () => {
    const tree = buildProposalItemTree([
      dbRow({ id: "p1", fixed_price: "4000.50" }),
      dbRow({ id: "c1", parent_line_item_id: "p1", fixed_price: "1000.25" }),
    ]);
    expect(tree[0]?.fixedPrice).toBe(4000.5);
    expect(tree[0]?.phases[0]?.fixedPrice).toBe(1000.25);
  });

  it("maps snake_case row fields onto the camelCase node shape", () => {
    const tree = buildProposalItemTree([
      dbRow({
        id: "p1",
        summary: "one-liner",
        body_markdown: "**body**",
        description: "desc",
        why_it_matters: "why",
        out_of_scope: "not this",
        definition_of_done: "done when",
      }),
    ]);
    expect(tree[0]).toMatchObject({
      summary: "one-liner",
      bodyMarkdown: "**body**",
      description: "desc",
      whyItMatters: "why",
      outOfScope: "not this",
      definitionOfDone: "done when",
    });
  });

  it("returns an empty tree for no rows", () => {
    expect(buildProposalItemTree([])).toEqual([]);
  });

  it("select-string covers exactly the fields the builder reads", () => {
    const columns = PROPOSAL_ITEM_COLUMNS.split(", ");
    expect(columns).toEqual([
      "id",
      "parent_line_item_id",
      "sort_order",
      "title",
      "summary",
      "body_markdown",
      "description",
      "why_it_matters",
      "out_of_scope",
      "definition_of_done",
      "fixed_price",
      "is_capped",
      "pricing_type",
      "hourly_rate",
      "estimate_low",
      "estimate_high",
      "estimated_hours",
    ]);
  });

  it("maps pricing_type + hourly sidecars onto the node (default fixed_bid)", () => {
    const tree = buildProposalItemTree([
      dbRow({ id: "p1" }),
      dbRow({
        id: "p2",
        pricing_type: "estimate_range",
        hourly_rate: "200.00",
        estimate_low: "3000",
        estimate_high: "5000",
        estimated_hours: "20",
      }),
    ]);
    expect(tree[0]?.pricingType).toBe("fixed_bid");
    expect(tree[0]?.hourlyRate).toBeNull();
    expect(tree[1]?.pricingType).toBe("estimate_range");
    expect(tree[1]?.hourlyRate).toBe(200);
    expect(tree[1]?.estimateLow).toBe(3000);
    expect(tree[1]?.estimateHigh).toBe(5000);
    expect(tree[1]?.estimatedHours).toBe(20);
  });

  it("coerces an unknown pricing_type to fixed_bid (never breaks a render)", () => {
    const tree = buildProposalItemTree([
      dbRow({ id: "p1", pricing_type: "bogus" }),
    ]);
    expect(tree[0]?.pricingType).toBe("fixed_bid");
  });
});

describe("deriveAnchorAmount", () => {
  const base = {
    fixedPrice: 0,
    hourlyRate: null,
    estimateLow: null,
    estimateHigh: null,
    estimatedHours: null,
  };
  it("fixed_bid → the entered price", () => {
    expect(deriveAnchorAmount("fixed_bid", { ...base, fixedPrice: 950 })).toBe(
      950,
    );
  });
  it("estimate_range → the conservative HIGH end", () => {
    expect(
      deriveAnchorAmount("estimate_range", {
        ...base,
        estimateLow: 3000,
        estimateHigh: 5000,
      }),
    ).toBe(5000);
  });
  it("estimate_tm → rate × hours, or 0 when hours unknown", () => {
    expect(
      deriveAnchorAmount("estimate_tm", {
        ...base,
        hourlyRate: 200,
        estimatedHours: 18,
      }),
    ).toBe(3600);
    expect(
      deriveAnchorAmount("estimate_tm", { ...base, hourlyRate: 200 }),
    ).toBe(0);
  });
  it("estimate_nte → the entered cap", () => {
    expect(
      deriveAnchorAmount("estimate_nte", { ...base, fixedPrice: 10000 }),
    ).toBe(10000);
  });
});

describe("itemPriceDisplay", () => {
  const base = {
    fixedPrice: 0,
    hourlyRate: null,
    estimateLow: null,
    estimateHigh: null,
  };
  it("fixed_bid → a fixed amount", () => {
    expect(
      itemPriceDisplay({ ...base, pricingType: "fixed_bid", fixedPrice: 4000 }),
    ).toEqual({ kind: "fixed", amount: 4000 });
  });
  it("estimate_nte → the cap (from fixedPrice)", () => {
    expect(
      itemPriceDisplay({
        ...base,
        pricingType: "estimate_nte",
        fixedPrice: 10000,
      }),
    ).toEqual({ kind: "nte", cap: 10000 });
  });
  it("estimate_range → the low/high band", () => {
    expect(
      itemPriceDisplay({
        ...base,
        pricingType: "estimate_range",
        estimateLow: 3000,
        estimateHigh: 5000,
      }),
    ).toEqual({ kind: "range", low: 3000, high: 5000 });
  });
  it("estimate_tm → the rate", () => {
    expect(
      itemPriceDisplay({ ...base, pricingType: "estimate_tm", hourlyRate: 200 }),
    ).toEqual({ kind: "tm", rate: 200 });
  });
});

describe("validateProposalItems — pricing types", () => {
  const item = (o: Partial<ProposalItemInput>): ProposalItemInput => ({
    title: "X",
    fixedPrice: 100,
    ...o,
  });
  it("an hourly type needs a rate", () => {
    const issues = validateProposalItems([
      item({ pricingType: "estimate_tm", hourlyRate: null }),
    ]);
    expect(issues.some((i) => i.key === "rateRequired")).toBe(true);
  });
  it("a range needs low ≤ high", () => {
    const issues = validateProposalItems([
      item({
        pricingType: "estimate_range",
        hourlyRate: 200,
        estimateLow: 5000,
        estimateHigh: 3000,
      }),
    ]);
    expect(issues.some((i) => i.key === "rangeOrder")).toBe(true);
  });
  it("a range needs both ends", () => {
    const issues = validateProposalItems([
      item({ pricingType: "estimate_range", hourlyRate: 200 }),
    ]);
    expect(issues.some((i) => i.key === "rangeRequired")).toBe(true);
  });
  it("an NTE line needs a positive cap", () => {
    const issues = validateProposalItems([
      item({ pricingType: "estimate_nte", hourlyRate: 200, fixedPrice: 0 }),
    ]);
    expect(issues.some((i) => i.key === "capRequired")).toBe(true);
  });
  it("phases are a fixed-bid breakdown only", () => {
    const issues = validateProposalItems([
      item({
        pricingType: "estimate_tm",
        hourlyRate: 200,
        phases: [{ title: "P", fixedPrice: 50 }],
      }),
    ]);
    expect(issues.some((i) => i.key === "phasesFixedBidOnly")).toBe(true);
  });
  it("a complete fixed_bid item is clean", () => {
    expect(validateProposalItems([item({ pricingType: "fixed_bid" })])).toEqual(
      [],
    );
  });
});

describe("isHomogeneousFixedBid", () => {
  it("is true when every item is a fixed bid", () => {
    expect(
      isHomogeneousFixedBid([
        { pricingType: "fixed_bid" },
        { pricingType: "fixed_bid" },
      ]),
    ).toBe(true);
  });

  it("is false when any item is an estimate/NTE/T&M line", () => {
    expect(
      isHomogeneousFixedBid([
        { pricingType: "fixed_bid" },
        { pricingType: "estimate_nte" },
      ]),
    ).toBe(false);
  });

  it("is false for an empty proposal (nothing to assure)", () => {
    expect(isHomogeneousFixedBid([])).toBe(false);
  });
});
