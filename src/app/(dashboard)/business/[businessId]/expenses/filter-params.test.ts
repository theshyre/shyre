import { describe, it, expect } from "vitest";
import {
  applyBillableFilter,
  applyProjectFilter,
  applyYearShortcut,
  buildExpenseFilterParams,
  deriveYearValue,
  emptyExpenseFilters,
  hasActiveFilters,
  isCustomDateRange,
  parseExpenseFilters,
  toggleCategory,
} from "./filter-params";

describe("parseExpenseFilters", () => {
  it("returns empty filters from empty input", () => {
    expect(parseExpenseFilters({})).toEqual(emptyExpenseFilters());
  });

  it("reads q as a free-text string", () => {
    expect(parseExpenseFilters({ q: "linode" }).q).toBe("linode");
  });

  it("expands ?year=2019 into from/to range", () => {
    const f = parseExpenseFilters({ year: "2019" });
    expect(f.from).toBe("2019-01-01");
    expect(f.to).toBe("2019-12-31");
  });

  it("ignores invalid year values", () => {
    expect(parseExpenseFilters({ year: "not-a-year" }).from).toBeNull();
    expect(parseExpenseFilters({ year: "999" }).from).toBeNull();
    expect(parseExpenseFilters({ year: "20190" }).from).toBeNull();
  });

  it("explicit from/to override year shortcut", () => {
    const f = parseExpenseFilters({
      year: "2019",
      from: "2019-03-01",
      to: "2019-09-30",
    });
    expect(f.from).toBe("2019-03-01");
    expect(f.to).toBe("2019-09-30");
  });

  it("rejects malformed dates silently", () => {
    expect(parseExpenseFilters({ from: "not-a-date" }).from).toBeNull();
    expect(parseExpenseFilters({ from: "2019-13-01" }).from).toBeNull();
    expect(parseExpenseFilters({ from: "2019-02-30" }).from).toBeNull();
  });

  it("parses comma-separated category list", () => {
    const f = parseExpenseFilters({ category: "software,other" });
    expect(f.categories).toEqual(["software", "other"]);
  });

  it("parses repeated category params (?category=a&category=b)", () => {
    const f = parseExpenseFilters({ category: ["software", "other"] });
    expect(f.categories.sort()).toEqual(["other", "software"]);
  });

  it("filters out unknown categories", () => {
    const f = parseExpenseFilters({ category: "software,bogus,other" });
    expect(f.categories).toEqual(["software", "other"]);
  });

  it("de-dupes repeated categories", () => {
    const f = parseExpenseFilters({ category: "software,software" });
    expect(f.categories).toEqual(["software"]);
  });

  it("recognizes project=none for unassigned filter", () => {
    expect(parseExpenseFilters({ project: "none" }).project).toBe("none");
  });

  it("accepts a UUID-looking project id", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(parseExpenseFilters({ project: id }).project).toBe(id);
  });

  it("rejects non-UUID project strings other than 'none'", () => {
    expect(parseExpenseFilters({ project: "bogus" }).project).toBeNull();
  });

  it("billable accepts true / false strings only", () => {
    expect(parseExpenseFilters({ billable: "true" }).billable).toBe(true);
    expect(parseExpenseFilters({ billable: "false" }).billable).toBe(false);
    expect(parseExpenseFilters({ billable: "yes" }).billable).toBeNull();
    expect(parseExpenseFilters({ billable: "" }).billable).toBeNull();
  });
});

describe("hasActiveFilters", () => {
  it("returns false on empty", () => {
    expect(hasActiveFilters(emptyExpenseFilters())).toBe(false);
  });

  it("returns true if any field is set", () => {
    expect(
      hasActiveFilters({ ...emptyExpenseFilters(), q: "linode" }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...emptyExpenseFilters(), from: "2019-01-01" }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...emptyExpenseFilters(), categories: ["other"] }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...emptyExpenseFilters(), project: "none" }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...emptyExpenseFilters(), billable: false }),
    ).toBe(true);
  });
});

describe("deriveYearValue", () => {
  it("returns the year when from/to span exactly Jan 1 → Dec 31", () => {
    expect(
      deriveYearValue({
        ...emptyExpenseFilters(),
        from: "2019-01-01",
        to: "2019-12-31",
      }),
    ).toBe("2019");
  });

  it("returns empty when only from is set", () => {
    expect(
      deriveYearValue({
        ...emptyExpenseFilters(),
        from: "2019-01-01",
      }),
    ).toBe("");
  });

  it("returns empty for custom non-year-aligned range", () => {
    expect(
      deriveYearValue({
        ...emptyExpenseFilters(),
        from: "2019-03-15",
        to: "2019-09-30",
      }),
    ).toBe("");
  });

  it("returns empty when from year doesn't match to year", () => {
    expect(
      deriveYearValue({
        ...emptyExpenseFilters(),
        from: "2019-01-01",
        to: "2020-12-31",
      }),
    ).toBe("");
  });

  it("returns empty for empty filters", () => {
    expect(deriveYearValue(emptyExpenseFilters())).toBe("");
  });
});

describe("isCustomDateRange", () => {
  it("false when no date filter is set", () => {
    expect(isCustomDateRange(emptyExpenseFilters())).toBe(false);
  });

  it("false when filter is a year shortcut", () => {
    expect(
      isCustomDateRange({
        ...emptyExpenseFilters(),
        from: "2019-01-01",
        to: "2019-12-31",
      }),
    ).toBe(false);
  });

  it("true when from is set but not on Jan 1", () => {
    expect(
      isCustomDateRange({
        ...emptyExpenseFilters(),
        from: "2019-03-15",
      }),
    ).toBe(true);
  });

  it("true when only to is set", () => {
    expect(
      isCustomDateRange({
        ...emptyExpenseFilters(),
        to: "2019-09-30",
      }),
    ).toBe(true);
  });
});

describe("applyYearShortcut", () => {
  it("sets from/to to the year boundaries", () => {
    const f = applyYearShortcut(emptyExpenseFilters(), "2019");
    expect(f.from).toBe("2019-01-01");
    expect(f.to).toBe("2019-12-31");
  });

  it("empty year clears from/to", () => {
    const initial = {
      ...emptyExpenseFilters(),
      from: "2019-01-01",
      to: "2019-12-31",
    };
    const cleared = applyYearShortcut(initial, "");
    expect(cleared.from).toBeNull();
    expect(cleared.to).toBeNull();
  });

  it("preserves other filters", () => {
    const initial = { ...emptyExpenseFilters(), q: "linode" };
    expect(applyYearShortcut(initial, "2019").q).toBe("linode");
  });
});

describe("toggleCategory", () => {
  it("adds a category not currently selected", () => {
    const f = toggleCategory(emptyExpenseFilters(), "software");
    expect(f.categories).toEqual(["software"]);
  });

  it("removes a category currently selected", () => {
    const initial = { ...emptyExpenseFilters(), categories: ["software", "other"] };
    const f = toggleCategory(initial, "software");
    expect(f.categories).toEqual(["other"]);
  });

  it("ignores unknown categories", () => {
    const initial = { ...emptyExpenseFilters(), categories: ["software"] };
    const f = toggleCategory(initial, "bogus");
    expect(f).toBe(initial); // identity preserved
  });
});

describe("applyProjectFilter", () => {
  it("empty string clears the filter", () => {
    const f = applyProjectFilter(
      { ...emptyExpenseFilters(), project: "p1" },
      "",
    );
    expect(f.project).toBeNull();
  });

  it("'none' is preserved as the unassigned-only filter", () => {
    const f = applyProjectFilter(emptyExpenseFilters(), "none");
    expect(f.project).toBe("none");
  });

  it("an id is preserved verbatim", () => {
    const f = applyProjectFilter(emptyExpenseFilters(), "p1");
    expect(f.project).toBe("p1");
  });
});

describe("applyBillableFilter", () => {
  it("true → boolean true", () => {
    expect(applyBillableFilter(emptyExpenseFilters(), "true").billable).toBe(true);
  });
  it("false → boolean false", () => {
    expect(applyBillableFilter(emptyExpenseFilters(), "false").billable).toBe(false);
  });
  it("anything else clears", () => {
    expect(applyBillableFilter(emptyExpenseFilters(), "").billable).toBeNull();
    expect(applyBillableFilter(emptyExpenseFilters(), "yes").billable).toBeNull();
  });
});

describe("buildExpenseFilterParams", () => {
  it("omits empty / null fields", () => {
    const sp = buildExpenseFilterParams(emptyExpenseFilters());
    expect(sp.toString()).toBe("");
  });

  it("serializes a populated filter", () => {
    const sp = buildExpenseFilterParams({
      q: "linode",
      from: "2019-01-01",
      to: "2019-12-31",
      categories: ["software", "other"],
      project: "p1",
      billable: true,
    });
    // Output order is implementation-dependent; check each individually.
    expect(sp.get("q")).toBe("linode");
    expect(sp.get("from")).toBe("2019-01-01");
    expect(sp.get("to")).toBe("2019-12-31");
    expect(sp.get("category")).toBe("software,other");
    expect(sp.get("project")).toBe("p1");
    expect(sp.get("billable")).toBe("true");
  });

  it("round-trips through parse without loss", () => {
    const original = {
      q: "linode",
      from: "2019-01-01",
      to: "2019-12-31",
      categories: ["software", "other"],
      project: "11111111-2222-3333-4444-555555555555",
      billable: false,
    };
    const sp = buildExpenseFilterParams(original);
    const round = parseExpenseFilters(Object.fromEntries(sp.entries()));
    expect(round).toEqual(original);
  });
});
