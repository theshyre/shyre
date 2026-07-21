import { describe, expect, it } from "vitest";
import {
  classifyNet,
  DEFAULT_PERIOD,
  financialTeamIds,
  groupViewerBusinesses,
  formatCurrency,
  formatSignedCurrency,
  groupByCurrency,
  maxRole,
  netForBusiness,
  parsePeriod,
  periodCutoff,
  sortByCurrency,
} from "./business-list-helpers";

describe("periodCutoff", () => {
  const anchor = new Date("2026-05-06T15:30:00Z");

  it("returns Jan 1 UTC of the current year for `ytd`", () => {
    expect(periodCutoff("ytd", anchor)).toBe(
      new Date("2026-01-01T00:00:00Z").toISOString(),
    );
  });

  it("returns the 1st-of-month UTC for `month`", () => {
    expect(periodCutoff("month", anchor)).toBe(
      new Date("2026-05-01T00:00:00Z").toISOString(),
    );
  });

  it("returns 12 months before now for `last12`", () => {
    expect(periodCutoff("last12", anchor)).toBe(
      new Date("2025-05-06T15:30:00Z").toISOString(),
    );
  });

  it("`last12` survives month-end rollovers without producing NaN", () => {
    const cutoff = periodCutoff("last12", new Date("2026-03-31T00:00:00Z"));
    const parsed = new Date(cutoff);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getUTCFullYear()).toBe(2025);
  });
});

describe("parsePeriod", () => {
  it("returns the default for null / undefined / empty", () => {
    expect(parsePeriod(null)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod(undefined)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod("")).toBe(DEFAULT_PERIOD);
  });

  it("returns the matching period for a known token", () => {
    expect(parsePeriod("ytd")).toBe("ytd");
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("last12")).toBe("last12");
  });

  it("falls back to default for an unrecognized token", () => {
    expect(parsePeriod("yesterday")).toBe(DEFAULT_PERIOD);
    expect(parsePeriod("Q1")).toBe(DEFAULT_PERIOD);
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

describe("financialTeamIds", () => {
  it("includes only teams where the viewer is owner or admin", () => {
    expect(
      financialTeamIds([
        { id: "t-owner", role: "owner" },
        { id: "t-admin", role: "admin" },
        { id: "t-member", role: "member" },
      ]),
    ).toEqual(["t-owner", "t-admin"]);
  });

  it("excludes a member-team even when the viewer is admin elsewhere (SAL-057)", () => {
    // The leak: aggregate-max-role treated this viewer as admin and
    // summed BOTH teams. Financials must cover only the admin team.
    expect(
      financialTeamIds([
        { id: "t-admin", role: "admin" },
        { id: "t-member", role: "member" },
      ]),
    ).toEqual(["t-admin"]);
  });

  it("returns an empty list for a member-only viewer", () => {
    expect(
      financialTeamIds([
        { id: "t-1", role: "member" },
        { id: "t-2", role: "member" },
      ]),
    ).toEqual([]);
  });

  it("returns an empty list for no teams", () => {
    expect(financialTeamIds([])).toEqual([]);
  });
});

describe("groupViewerBusinesses", () => {
  it("groups teams into distinct businesses, sorted by display name", () => {
    const result = groupViewerBusinesses(
      [
        { id: "t-z", name: "Zephyr Team" },
        { id: "t-a", name: "Acme Team" },
        { id: "t-b", name: "Beta Team" },
      ],
      [
        { id: "t-z", business_id: "biz-2" },
        { id: "t-a", business_id: "biz-1" },
        { id: "t-b", business_id: "biz-1" },
      ],
      [
        { id: "biz-1", legal_name: "Acme LLC" },
        { id: "biz-2", legal_name: null },
      ],
    );
    // biz-1 "Acme LLC" sorts before biz-2 (fallback name "Zephyr Team").
    expect(result).toEqual([
      { id: "biz-1", name: "Acme Team", legalName: "Acme LLC" },
      { id: "biz-2", name: "Zephyr Team", legalName: null },
    ]);
  });

  it("uses the alphabetically-first team name as the fallback display name", () => {
    const result = groupViewerBusinesses(
      [
        { id: "t-2", name: "West Team" },
        { id: "t-1", name: "East Team" },
      ],
      [
        { id: "t-2", business_id: "biz-1" },
        { id: "t-1", business_id: "biz-1" },
      ],
      [{ id: "biz-1", legal_name: null }],
    );
    expect(result).toEqual([
      { id: "biz-1", name: "East Team", legalName: null },
    ]);
  });

  it("skips teams with no business_id", () => {
    const result = groupViewerBusinesses(
      [
        { id: "t-1", name: "Real Team" },
        { id: "t-orphan", name: "Orphan Team" },
      ],
      [
        { id: "t-1", business_id: "biz-1" },
        { id: "t-orphan", business_id: null },
      ],
      [{ id: "biz-1", legal_name: "Real Co" }],
    );
    expect(result).toEqual([
      { id: "biz-1", name: "Real Team", legalName: "Real Co" },
    ]);
  });

  it("returns an empty list when the viewer has no teams", () => {
    expect(groupViewerBusinesses([], [], [])).toEqual([]);
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
