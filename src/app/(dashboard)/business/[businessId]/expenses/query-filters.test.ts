import { describe, it, expect } from "vitest";
import { applyExpenseFilters } from "./query-filters";
import { emptyExpenseFilters } from "./filter-params";
import type { ExpenseFilters } from "./filter-params";

/**
 * `applyExpenseFilters` takes a Supabase query builder and chains
 * filter clauses onto it. We don't have a real Supabase here, so
 * we verify behavior with a minimal chain-recording mock builder
 * that returns itself from each method and logs the call shape.
 *
 * The contract under test: every `ExpenseFilters` field maps to
 * exactly one Supabase clause, and absent fields don't add noise.
 * A drift here vs `page.tsx` would manifest as the bulk
 * "Select all matching" action operating on a different row set
 * than the user saw — a silent correctness bug we want to make
 * impossible.
 */

type Call = { method: string; args: unknown[] };

interface RecorderBuilder {
  or(arg: string): RecorderBuilder;
  gte(col: string, value: string): RecorderBuilder;
  lte(col: string, value: string): RecorderBuilder;
  in(col: string, values: string[]): RecorderBuilder;
  is(col: string, value: null): RecorderBuilder;
  eq(col: string, value: string | boolean): RecorderBuilder;
}

function makeRecorder(): { builder: RecorderBuilder; calls: Call[] } {
  const calls: Call[] = [];
  const builder: RecorderBuilder = {
    or(arg) {
      calls.push({ method: "or", args: [arg] });
      return builder;
    },
    gte(col, value) {
      calls.push({ method: "gte", args: [col, value] });
      return builder;
    },
    lte(col, value) {
      calls.push({ method: "lte", args: [col, value] });
      return builder;
    },
    in(col, values) {
      calls.push({ method: "in", args: [col, values] });
      return builder;
    },
    is(col, value) {
      calls.push({ method: "is", args: [col, value] });
      return builder;
    },
    eq(col, value) {
      calls.push({ method: "eq", args: [col, value] });
      return builder;
    },
  };
  return { builder, calls };
}

describe("applyExpenseFilters", () => {
  it("makes no calls when filters are empty", () => {
    const { builder, calls } = makeRecorder();
    const out = applyExpenseFilters(builder, emptyExpenseFilters());
    expect(calls).toEqual([]);
    expect(out).toBe(builder); // returns same builder for chaining
  });

  it("applies a free-text query as an `or` ilike across vendor / description / notes", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, { ...emptyExpenseFilters(), q: "jira" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      method: "or",
      args: [
        "vendor.ilike.%jira%,description.ilike.%jira%,notes.ilike.%jira%",
      ],
    });
  });

  it("strips parens and commas from free-text search to keep the or-builder honest", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, {
      ...emptyExpenseFilters(),
      q: "jira (cloud), v2",
    });
    expect(calls).toHaveLength(1);
    expect((calls[0]?.args?.[0] as string)).not.toContain("(");
    expect((calls[0]?.args?.[0] as string)).not.toContain(",v");
  });

  it("does not call `or` when q is whitespace-only after sanitization", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, { ...emptyExpenseFilters(), q: "(),," });
    expect(calls).toEqual([]);
  });

  it("applies a from date as `gte`", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, {
      ...emptyExpenseFilters(),
      from: "2025-01-01",
    });
    expect(calls).toEqual([
      { method: "gte", args: ["incurred_on", "2025-01-01"] },
    ]);
  });

  it("applies a to date as `lte`", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, {
      ...emptyExpenseFilters(),
      to: "2025-12-31",
    });
    expect(calls).toEqual([
      { method: "lte", args: ["incurred_on", "2025-12-31"] },
    ]);
  });

  it("applies multi-category filter as `in`", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, {
      ...emptyExpenseFilters(),
      categories: ["software", "hardware"],
    });
    expect(calls).toEqual([
      { method: "in", args: ["category", ["software", "hardware"]] },
    ]);
  });

  it("applies project=none as `is(project_id, null)`", () => {
    const { builder, calls } = makeRecorder();
    const filters: ExpenseFilters = { ...emptyExpenseFilters(), project: "none" };
    applyExpenseFilters(builder, filters);
    expect(calls).toEqual([{ method: "is", args: ["project_id", null] }]);
  });

  it("applies a project id as `eq(project_id, ...)`", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, {
      ...emptyExpenseFilters(),
      project: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(calls).toEqual([
      {
        method: "eq",
        args: ["project_id", "550e8400-e29b-41d4-a716-446655440000"],
      },
    ]);
  });

  it("applies billable=true as `eq(billable, true)`", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, {
      ...emptyExpenseFilters(),
      billable: true,
    });
    expect(calls).toEqual([{ method: "eq", args: ["billable", true] }]);
  });

  it("applies billable=false as `eq(billable, false)`", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, {
      ...emptyExpenseFilters(),
      billable: false,
    });
    expect(calls).toEqual([{ method: "eq", args: ["billable", false] }]);
  });

  it("applies all filters in a complex spec without dropping any", () => {
    const { builder, calls } = makeRecorder();
    applyExpenseFilters(builder, {
      q: "jira",
      from: "2025-01-01",
      to: "2025-12-31",
      categories: ["software"],
      project: "none",
      billable: true,
    });
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("or");
    expect(methods).toContain("gte");
    expect(methods).toContain("lte");
    expect(methods).toContain("in");
    expect(methods).toContain("is");
    expect(methods).toContain("eq");
    expect(calls).toHaveLength(6);
  });
});
