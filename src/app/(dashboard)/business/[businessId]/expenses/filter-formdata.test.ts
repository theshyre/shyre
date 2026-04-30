import { describe, it, expect } from "vitest";
import {
  appendFilterParams,
  readFilterParamsFromFormData,
} from "./filter-formdata";
import { parseExpenseFilters, emptyExpenseFilters } from "./filter-params";
import type { ExpenseFilters } from "./filter-params";

/**
 * Round-trip: client packs filters into FormData under `filter_*`
 * keys; server reads the same FormData back via the parser. The
 * "select all matching" bulk path is only safe if these two halves
 * agree on every field. A drift here would silently apply a
 * different filter than the user saw.
 */
describe("filter-formdata round-trip", () => {
  function roundTrip(input: ExpenseFilters): ExpenseFilters {
    const fd = new FormData();
    appendFilterParams(fd, input);
    return parseExpenseFilters(readFilterParamsFromFormData(fd));
  }

  it("empty filters round-trip to empty", () => {
    const out = roundTrip(emptyExpenseFilters());
    expect(out).toEqual(emptyExpenseFilters());
  });

  it("preserves a free-text query", () => {
    const input = { ...emptyExpenseFilters(), q: "jira" };
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves a date range", () => {
    const input = {
      ...emptyExpenseFilters(),
      from: "2025-01-01",
      to: "2025-12-31",
    };
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves a single category filter", () => {
    const input = { ...emptyExpenseFilters(), categories: ["software"] };
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves multiple category filters", () => {
    const input = {
      ...emptyExpenseFilters(),
      categories: ["software", "hardware"],
    };
    const out = roundTrip(input);
    // parseExpenseFilters de-dupes via Set so order may differ;
    // compare as sets.
    expect(new Set(out.categories)).toEqual(new Set(input.categories));
  });

  it("preserves a project id", () => {
    const projectId = "550e8400-e29b-41d4-a716-446655440000";
    const input = { ...emptyExpenseFilters(), project: projectId };
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves project=none (unassigned filter)", () => {
    const input: ExpenseFilters = {
      ...emptyExpenseFilters(),
      project: "none",
    };
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves billable=true", () => {
    const input: ExpenseFilters = {
      ...emptyExpenseFilters(),
      billable: true,
    };
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves billable=false", () => {
    const input: ExpenseFilters = {
      ...emptyExpenseFilters(),
      billable: false,
    };
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves a complex multi-filter spec", () => {
    const input: ExpenseFilters = {
      q: "jira",
      from: "2024-01-01",
      to: "2024-12-31",
      categories: ["software", "subscriptions"],
      project: "none",
      billable: true,
    };
    const out = roundTrip(input);
    expect(out.q).toBe(input.q);
    expect(out.from).toBe(input.from);
    expect(out.to).toBe(input.to);
    expect(new Set(out.categories)).toEqual(new Set(input.categories));
    expect(out.project).toBe(input.project);
    expect(out.billable).toBe(input.billable);
  });
});

describe("readFilterParamsFromFormData", () => {
  it("ignores non-filter_ keys", () => {
    const fd = new FormData();
    fd.set("scope", "filters");
    fd.set("businessId", "abc-123");
    fd.set("category", "software"); // action-target, not a filter
    fd.append("id", "row-1");
    expect(readFilterParamsFromFormData(fd)).toEqual({});
  });

  it("skips empty filter values", () => {
    const fd = new FormData();
    fd.set("filter_q", "");
    fd.set("filter_from", "");
    expect(readFilterParamsFromFormData(fd)).toEqual({});
  });

  it("joins multiple filter_category values into a comma list", () => {
    const fd = new FormData();
    fd.append("filter_category", "software");
    fd.append("filter_category", "hardware");
    expect(readFilterParamsFromFormData(fd)).toEqual({
      category: "software,hardware",
    });
  });
});
