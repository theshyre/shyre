import { describe, expect, it } from "vitest";
import {
  classifyNet,
  formatCurrency,
  formatSignedCurrency,
  groupByCurrency,
  maxRole,
  netForBusiness,
  rolling12MonthCutoff,
  sortByCurrency,
} from "./business-list-helpers";

describe("rolling12MonthCutoff", () => {
  it("returns a date 12 months before the given anchor", () => {
    const cutoff = rolling12MonthCutoff(new Date("2026-05-06T00:00:00Z"));
    expect(cutoff).toBe(new Date("2025-05-06T00:00:00Z").toISOString());
  });

  it("handles month-end roll-over without producing an invalid date", () => {
    // March 31 -> 12 months back. Some date math libs land on
    // Feb 31 (invalid) and roll to March 3; we just want a real
    // date in the right ballpark, not exact day arithmetic.
    const cutoff = rolling12MonthCutoff(new Date("2026-03-31T00:00:00Z"));
    const parsed = new Date(cutoff);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getFullYear()).toBe(2025);
  });
});

describe("maxRole", () => {
  it("returns 'member' for an empty list", () => {
    expect(maxRole([])).toBe("member");
  });

  it("returns 'owner' if any entry is owner", () => {
    expect(maxRole(["member", "admin", "owner"])).toBe("owner");
    expect(maxRole(["owner"])).toBe("owner");
  });

  it("returns 'admin' if there's an admin but no owner", () => {
    expect(maxRole(["member", "admin"])).toBe("admin");
    expect(maxRole(["admin", "member"])).toBe("admin");
  });

  it("returns 'member' if every role is member", () => {
    expect(maxRole(["member", "member"])).toBe("member");
  });
});

describe("groupByCurrency", () => {
  it("returns an empty map for empty input", () => {
    expect(groupByCurrency([]).size).toBe(0);
  });

  it("sums amounts within the same currency", () => {
    const out = groupByCurrency([
      { amount: 100, currency: "USD" },
      { amount: 50.5, currency: "USD" },
    ]);
    expect(out.get("USD")).toBe(150.5);
  });

  it("keeps multi-currency totals separate", () => {
    const out = groupByCurrency([
      { amount: 100, currency: "USD" },
      { amount: 80, currency: "EUR" },
      { amount: 200, currency: "USD" },
    ]);
    expect(out.get("USD")).toBe(300);
    expect(out.get("EUR")).toBe(80);
  });

  it("uppercases currency codes so 'usd' and 'USD' merge", () => {
    const out = groupByCurrency([
      { amount: 10, currency: "usd" },
      { amount: 5, currency: "USD" },
    ]);
    expect(out.get("USD")).toBe(15);
    expect(out.has("usd")).toBe(false);
  });

  it("treats null/undefined currency as USD (legacy rows)", () => {
    const out = groupByCurrency([
      { amount: 10, currency: null },
      { amount: 5, currency: "USD" },
    ]);
    expect(out.get("USD")).toBe(15);
  });

  it("coerces string amounts (Postgres numeric → string in JS)", () => {
    const out = groupByCurrency([
      { amount: "10.50", currency: "USD" },
      { amount: "0.25", currency: "USD" },
    ]);
    expect(out.get("USD")).toBe(10.75);
  });

  it("handles null amount as 0", () => {
    const out = groupByCurrency([{ amount: null, currency: "USD" }]);
    expect(out.get("USD")).toBe(0);
  });
});

describe("netForBusiness", () => {
  it("returns null when revenue and expenses are in different currencies", () => {
    const revenue = new Map([["USD", 1000]]);
    const expenses = new Map([["EUR", 500]]);
    expect(netForBusiness(revenue, expenses)).toBeNull();
  });

  it("returns null when either side has multiple currencies", () => {
    const revenue = new Map([
      ["USD", 1000],
      ["EUR", 200],
    ]);
    const expenses = new Map([["USD", 500]]);
    expect(netForBusiness(revenue, expenses)).toBeNull();
  });

  it("computes net when both sides share one currency", () => {
    const revenue = new Map([["USD", 1200]]);
    const expenses = new Map([["USD", 800]]);
    expect(netForBusiness(revenue, expenses)).toEqual({
      amount: 400,
      currency: "USD",
    });
  });

  it("handles revenue-only (no expenses) as full revenue", () => {
    const revenue = new Map([["USD", 500]]);
    const expenses = new Map<string, number>();
    expect(netForBusiness(revenue, expenses)).toEqual({
      amount: 500,
      currency: "USD",
    });
  });

  it("handles expenses-only as a negative net", () => {
    const revenue = new Map<string, number>();
    const expenses = new Map([["USD", 200]]);
    expect(netForBusiness(revenue, expenses)).toEqual({
      amount: -200,
      currency: "USD",
    });
  });

  it("returns null when both maps are empty (no activity)", () => {
    expect(
      netForBusiness(new Map(), new Map()),
    ).toBeNull();
  });
});

describe("classifyNet", () => {
  it("classifies clearly positive as profit", () => {
    expect(classifyNet(100)).toBe("profit");
    expect(classifyNet(0.01)).toBe("profit");
  });

  it("classifies clearly negative as loss", () => {
    expect(classifyNet(-100)).toBe("loss");
    expect(classifyNet(-0.01)).toBe("loss");
  });

  it("classifies near-zero values within half a cent as break-even", () => {
    expect(classifyNet(0)).toBe("breakEven");
    expect(classifyNet(0.004)).toBe("breakEven");
    expect(classifyNet(-0.004)).toBe("breakEven");
  });
});

describe("formatCurrency", () => {
  it("renders USD with the dollar sign", () => {
    expect(formatCurrency(1234.5, "USD")).toBe("$1,234.50");
  });

  it("renders EUR with the euro sign in en-US locale", () => {
    expect(formatCurrency(80, "EUR")).toBe("€80.00");
  });

  it("renders zero with the standard format", () => {
    expect(formatCurrency(0, "USD")).toBe("$0.00");
  });
});

describe("formatSignedCurrency", () => {
  it("prefixes positive non-zero amounts with +", () => {
    expect(formatSignedCurrency(100, "USD")).toBe("+$100.00");
  });

  it("prefixes negative amounts with the unicode minus", () => {
    expect(formatSignedCurrency(-100, "USD")).toBe("−$100.00");
  });

  it("renders break-even (within tolerance) without a sign", () => {
    expect(formatSignedCurrency(0, "USD")).toBe("$0.00");
    expect(formatSignedCurrency(0.001, "USD")).toBe("$0.00");
  });
});

describe("sortByCurrency", () => {
  it("sorts entries alphabetically by currency code", () => {
    const map = new Map([
      ["USD", 100],
      ["EUR", 50],
      ["AUD", 25],
    ]);
    expect(sortByCurrency(map)).toEqual([
      ["AUD", 25],
      ["EUR", 50],
      ["USD", 100],
    ]);
  });

  it("returns an empty array for an empty map", () => {
    expect(sortByCurrency(new Map())).toEqual([]);
  });
});
