import { describe, it, expect } from "vitest";
import {
  groupErrorRows,
  groupKeyFor,
  type ErrorLogRow,
} from "./group-errors";

function row(overrides: Partial<ErrorLogRow> = {}): ErrorLogRow {
  return {
    id: "e-1",
    error_code: "DATABASE_ERROR",
    severity: "error",
    message: "connection refused",
    action: "createCustomerAction",
    user_id: "u-1",
    team_id: "t-1",
    url: "/customers",
    details: null,
    stack_trace: null,
    resolved_at: null,
    created_at: "2026-07-01T10:00:00+00:00",
    ...overrides,
  };
}

describe("groupErrorRows", () => {
  it("returns an empty list for no rows", () => {
    expect(groupErrorRows([])).toEqual([]);
  });

  it("collapses identical code+message+action+url into one group with count and first/last seen", () => {
    const groups = groupErrorRows([
      row({ id: "a", created_at: "2026-07-03T10:00:00+00:00" }),
      row({ id: "b", created_at: "2026-07-01T10:00:00+00:00" }),
      row({ id: "c", created_at: "2026-07-02T10:00:00+00:00" }),
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g?.count).toBe(3);
    expect(g?.firstSeen).toBe("2026-07-01T10:00:00+00:00");
    expect(g?.lastSeen).toBe("2026-07-03T10:00:00+00:00");
    expect(g?.newest.id).toBe("a");
    // Occurrences newest-first.
    expect(g?.occurrences.map((o) => o.id)).toEqual(["a", "c", "b"]);
  });

  it("does NOT group rows whose url differs", () => {
    const groups = groupErrorRows([
      row({ id: "a", url: "/customers" }),
      row({ id: "b", url: "/projects" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("does NOT group rows whose action differs (null vs named)", () => {
    const groups = groupErrorRows([
      row({ id: "a", action: null }),
      row({ id: "b", action: "createCustomerAction" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("does NOT group rows whose message or code differ", () => {
    const groups = groupErrorRows([
      row({ id: "a", message: "boom" }),
      row({ id: "b", message: "bang" }),
      row({ id: "c", message: "boom", error_code: "UNKNOWN" }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("field-boundary shifts do not collide (NUL-joined key, not concatenation)", () => {
    const a = row({ error_code: "AB", message: "C" });
    const b = row({ error_code: "A", message: "BC" });
    expect(groupKeyFor(a)).not.toBe(groupKeyFor(b));
    expect(groupErrorRows([a, b])).toHaveLength(2);
  });

  it("picks the newest non-null stack trace and non-empty details", () => {
    const groups = groupErrorRows([
      row({ id: "newest", created_at: "2026-07-03T10:00:00+00:00" }),
      row({
        id: "mid",
        created_at: "2026-07-02T10:00:00+00:00",
        stack_trace: "at mid()",
        details: { pgCode: "42501" },
      }),
      row({
        id: "old",
        created_at: "2026-07-01T10:00:00+00:00",
        stack_trace: "at old()",
        details: { pgCode: "23505" },
      }),
    ]);
    expect(groups[0]?.stackTrace).toBe("at mid()");
    expect(groups[0]?.details).toEqual({ pgCode: "42501" });
  });

  it("collects only unresolved ids and flags a fully-resolved group", () => {
    const mixed = groupErrorRows([
      row({ id: "a", resolved_at: "2026-07-04T10:00:00+00:00" }),
      row({ id: "b", created_at: "2026-07-02T10:00:00+00:00" }),
    ]);
    expect(mixed[0]?.unresolvedIds).toEqual(["b"]);
    expect(mixed[0]?.allResolved).toBe(false);

    const done = groupErrorRows([
      row({ id: "a", resolved_at: "2026-07-04T10:00:00+00:00" }),
    ]);
    expect(done[0]?.allResolved).toBe(true);
    expect(done[0]?.unresolvedIds).toEqual([]);
  });

  it("orders groups by lastSeen desc even when the input is unordered", () => {
    const groups = groupErrorRows([
      row({
        id: "old-group",
        message: "older issue",
        created_at: "2026-07-01T10:00:00+00:00",
      }),
      row({
        id: "new-group",
        message: "newer issue",
        created_at: "2026-07-05T10:00:00+00:00",
      }),
    ]);
    expect(groups.map((g) => g.newest.id)).toEqual(["new-group", "old-group"]);
  });

  it("compares timestamps by epoch, not lexically (offset-suffix trap)", () => {
    const groups = groupErrorRows([
      // 12:00+02:00 = 10:00Z — lexically LATER than "11:00" but earlier in time.
      row({ id: "earlier", created_at: "2026-07-01T12:00:00+02:00" }),
      row({ id: "later", created_at: "2026-07-01T11:00:00+00:00" }),
    ]);
    expect(groups[0]?.newest.id).toBe("later");
    expect(groups[0]?.firstSeen).toBe("2026-07-01T12:00:00+02:00");
    expect(groups[0]?.lastSeen).toBe("2026-07-01T11:00:00+00:00");
  });
});
