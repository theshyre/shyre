import { describe, it, expect } from "vitest";
import { computeSubProjectsRollup } from "./sub-projects-rollup";

interface NamedChild {
  id: string;
  name: string;
  status: string | null;
  hourly_rate: number | null;
  budget_hours: number | null;
}

function namedChild(
  overrides: Partial<NamedChild> & { id: string },
): NamedChild {
  return {
    name: `Child ${overrides.id}`,
    status: "active",
    hourly_rate: null,
    budget_hours: null,
    ...overrides,
  };
}

describe("computeSubProjectsRollup — totals", () => {
  it("parent-only (no children) returns parent's own minutes verbatim", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: 40,
      parentHourlyRate: 100,
      parentOwnMinutes: 600, // 10h
      children: [],
      minutesByChildId: new Map(),
    });
    expect(result.childRows).toEqual([]);
    expect(result.totals.minutes).toBe(600);
    expect(result.totals.hours).toBe(10);
    expect(result.totals.budgetHours).toBe(40);
    expect(result.totals.dollars).toBe(1000); // 10h × $100
    expect(result.totals.budgetDollars).toBe(4000); // 40h × $100
  });

  it("sums parent OWN minutes plus every child's minutes (never just children)", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 60, // 1h
      children: [namedChild({ id: "a" }), namedChild({ id: "b" })],
      minutesByChildId: new Map([
        ["a", 120], // 2h
        ["b", 30], // 0.5h
      ]),
    });
    expect(result.totals.minutes).toBe(60 + 120 + 30);
    expect(result.totals.hours).toBeCloseTo(3.5, 5);
  });

  it("budget total sums parent budget + every child budget; 0 when nothing is set", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [
        namedChild({ id: "a", budget_hours: null }),
        namedChild({ id: "b", budget_hours: null }),
      ],
      minutesByChildId: new Map(),
    });
    expect(result.totals.budgetHours).toBe(0);
  });

  it("budget total adds parent + each child's budget when set", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: 40,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [
        namedChild({ id: "a", budget_hours: 10 }),
        namedChild({ id: "b", budget_hours: 5 }),
      ],
      minutesByChildId: new Map(),
    });
    expect(result.totals.budgetHours).toBe(55);
  });
});

describe("computeSubProjectsRollup — per-child rows", () => {
  it("treats a missing minutes lookup as 0 (a child with no entries is valid)", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [namedChild({ id: "lonely" })],
      minutesByChildId: new Map(), // no entry for "lonely"
    });
    expect(result.childRows[0]?.minutes).toBe(0);
    expect(result.childRows[0]?.hours).toBe(0);
  });

  it("pct is null when child has no budget (so the bar can hide entirely)", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [namedChild({ id: "a", budget_hours: null })],
      minutesByChildId: new Map([["a", 600]]),
    });
    expect(result.childRows[0]?.pct).toBeNull();
  });

  it("pct is null when child budget is 0 (avoid divide-by-zero / bogus 0% bar)", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [namedChild({ id: "a", budget_hours: 0 })],
      minutesByChildId: new Map([["a", 600]]),
    });
    expect(result.childRows[0]?.pct).toBeNull();
  });

  it("pct reflects (hours / budget) × 100 when under budget", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [namedChild({ id: "a", budget_hours: 10 })],
      minutesByChildId: new Map([["a", 300]]), // 5h
    });
    expect(result.childRows[0]?.pct).toBe(50);
  });

  it("pct caps at 100 when child is over budget — bar never overflows the track", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [namedChild({ id: "a", budget_hours: 5 })],
      minutesByChildId: new Map([["a", 600]]), // 10h vs 5h budget
    });
    expect(result.childRows[0]?.pct).toBe(100);
  });

  it("preserves passed-in fields (name, status) on each row via generic", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [
        namedChild({ id: "a", name: "Phase 1", status: "archived" }),
      ],
      minutesByChildId: new Map([["a", 0]]),
    });
    expect(result.childRows[0]?.name).toBe("Phase 1");
    expect(result.childRows[0]?.status).toBe("archived");
  });
});

describe("computeSubProjectsRollup — rate fallback & dollar math", () => {
  it("uses child's own rate when set (parent rate ignored for that row)", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: 100,
      parentOwnMinutes: 0,
      children: [namedChild({ id: "a", hourly_rate: 250 })],
      minutesByChildId: new Map([["a", 60]]), // 1h
    });
    expect(result.childRows[0]?.effectiveRate).toBe(250);
    expect(result.totals.dollars).toBe(250); // 1h × $250
  });

  it("falls back to parent's rate when child has no rate", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: 100,
      parentOwnMinutes: 0,
      children: [namedChild({ id: "a", hourly_rate: null })],
      minutesByChildId: new Map([["a", 120]]), // 2h
    });
    expect(result.childRows[0]?.effectiveRate).toBe(100);
    expect(result.totals.dollars).toBe(200); // 2h × $100
  });

  it("a parent with no rate resolves to $0 — never fabricates revenue", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: 10,
      parentHourlyRate: null,
      parentOwnMinutes: 600,
      children: [
        namedChild({ id: "a", hourly_rate: null, budget_hours: 5 }),
      ],
      minutesByChildId: new Map([["a", 120]]),
    });
    expect(result.totals.dollars).toBe(0);
    expect(result.totals.budgetDollars).toBe(0);
    expect(result.childRows[0]?.effectiveRate).toBe(0);
  });

  it("dollar total sums parent OWN + every child at its effective rate", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: 100,
      parentOwnMinutes: 60, // 1h × $100 = $100
      children: [
        namedChild({ id: "a", hourly_rate: 250 }), // 2h × $250 = $500
        namedChild({ id: "b", hourly_rate: null }), // 0.5h × $100 = $50
      ],
      minutesByChildId: new Map([
        ["a", 120],
        ["b", 30],
      ]),
    });
    expect(result.totals.dollars).toBe(650);
  });

  it("budget dollars use each row's effective rate (not just the parent's)", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: 10, // 10h × $100 = $1000
      parentHourlyRate: 100,
      parentOwnMinutes: 0,
      children: [
        namedChild({ id: "a", hourly_rate: 250, budget_hours: 4 }), // 4h × $250 = $1000
        namedChild({ id: "b", hourly_rate: null, budget_hours: 2 }), // 2h × $100 = $200
      ],
      minutesByChildId: new Map(),
    });
    expect(result.totals.budgetDollars).toBe(2200);
  });
});

describe("computeSubProjectsRollup — edge cases", () => {
  it("zero parent minutes + no children yields all zeros (no NaN/Infinity)", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [],
      minutesByChildId: new Map(),
    });
    expect(result.totals.minutes).toBe(0);
    expect(result.totals.hours).toBe(0);
    expect(result.totals.budgetHours).toBe(0);
    expect(result.totals.dollars).toBe(0);
    expect(result.totals.budgetDollars).toBe(0);
  });

  it("preserves child input order in childRows", () => {
    const result = computeSubProjectsRollup({
      parentBudgetHours: null,
      parentHourlyRate: null,
      parentOwnMinutes: 0,
      children: [
        namedChild({ id: "z" }),
        namedChild({ id: "a" }),
        namedChild({ id: "m" }),
      ],
      minutesByChildId: new Map(),
    });
    expect(result.childRows.map((c) => c.id)).toEqual(["z", "a", "m"]);
  });
});
