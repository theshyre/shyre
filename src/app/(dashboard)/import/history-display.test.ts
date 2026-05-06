import { describe, it, expect } from "vitest";
import {
  effectiveStatusKind,
  buildCountsList,
  formatSkipBreakdown,
  sourceLabel,
  canRenderUndo,
} from "./history-display";

const labels = {
  customer: (n: number) => (n === 1 ? "customer" : "customers"),
  project: (n: number) => (n === 1 ? "project" : "projects"),
  timeEntry: (n: number) => (n === 1 ? "time entry" : "time entries"),
  expense: (n: number) => (n === 1 ? "expense" : "expenses"),
};

describe("effectiveStatusKind", () => {
  it("returns 'undone' when undone_at is set (overrides status)", () => {
    expect(
      effectiveStatusKind({ status: "completed", undone_at: "2026-04-23" }),
    ).toBe("undone");
    expect(
      effectiveStatusKind({ status: "failed", undone_at: "2026-04-23" }),
    ).toBe("undone");
  });
  it("passes through underlying status when not undone", () => {
    expect(effectiveStatusKind({ status: "completed", undone_at: null })).toBe(
      "completed",
    );
    expect(effectiveStatusKind({ status: "running", undone_at: null })).toBe(
      "running",
    );
    expect(effectiveStatusKind({ status: "failed", undone_at: null })).toBe(
      "failed",
    );
  });
  it("returns 'partial' when status='completed' AND errors are present", () => {
    expect(
      effectiveStatusKind({
        status: "completed",
        undone_at: null,
        summary: {
          errors: ["Time entries batch: new row violates row-level security policy"],
        },
      }),
    ).toBe("partial");
  });
  it("returns 'partial' when reconciliation reports a mismatch", () => {
    expect(
      effectiveStatusKind({
        status: "completed",
        undone_at: null,
        summary: {
          reconciliation: { match: false },
        },
      }),
    ).toBe("partial");
  });
  it("stays 'completed' when errors is empty AND reconciliation matches", () => {
    expect(
      effectiveStatusKind({
        status: "completed",
        undone_at: null,
        summary: {
          errors: [],
          reconciliation: { match: true },
        },
      }),
    ).toBe("completed");
  });
});

describe("buildCountsList", () => {
  it("returns [] when no summary", () => {
    expect(buildCountsList(null, labels)).toEqual([]);
  });
  it("returns [] when imported section missing", () => {
    expect(buildCountsList({}, labels)).toEqual([]);
  });
  it("returns [] when all counts are zero", () => {
    expect(
      buildCountsList(
        { imported: { customers: 0, projects: 0, timeEntries: 0 } },
        labels,
      ),
    ).toEqual([]);
  });
  it("pluralizes correctly for 1 customer", () => {
    expect(
      buildCountsList({ imported: { customers: 1 } }, labels),
    ).toEqual(["1 customer"]);
  });
  it("pluralizes for >1", () => {
    expect(
      buildCountsList(
        { imported: { customers: 2, projects: 5, timeEntries: 123 } },
        labels,
      ),
    ).toEqual(["2 customers", "5 projects", "123 time entries"]);
  });
  it("omits zero-count entries from a mixed summary", () => {
    expect(
      buildCountsList(
        { imported: { customers: 0, projects: 3, timeEntries: 0 } },
        labels,
      ),
    ).toEqual(["3 projects"]);
  });
  it("includes expenses count from a CSV-expenses run", () => {
    expect(
      buildCountsList(
        { imported: { expenses: 47 } },
        labels,
      ),
    ).toEqual(["47 expenses"]);
  });
  it("pluralizes a single expense", () => {
    expect(
      buildCountsList({ imported: { expenses: 1 } }, labels),
    ).toEqual(["1 expense"]);
  });
});

describe("formatSkipBreakdown", () => {
  it("returns '' for undefined reasons", () => {
    expect(formatSkipBreakdown(undefined)).toBe("");
  });
  it("returns '' for an empty reasons map", () => {
    expect(formatSkipBreakdown({})).toBe("");
  });
  it("returns '' when every reason has a zero count", () => {
    expect(formatSkipBreakdown({ duplicate: 0, invoice_locked: 0 })).toBe("");
  });
  it("formats a single reason as '<count> <reason>'", () => {
    expect(formatSkipBreakdown({ invoice_locked: 12 })).toBe("12 invoice_locked");
  });
  it("joins multiple reasons with ' · ' separator", () => {
    // Insertion order is preserved for equal counts; sort below
    // exercises the descending tie-break path explicitly.
    expect(
      formatSkipBreakdown({ invoice_locked: 5, duplicate: 5 }),
    ).toBe("5 invoice_locked · 5 duplicate");
  });
  it("emits reasons in descending count order so the largest skip class shows first", () => {
    expect(
      formatSkipBreakdown({
        duplicate: 3,
        invoice_locked: 23,
        no_user_mapping: 7,
      }),
    ).toBe("23 invoice_locked · 7 no_user_mapping · 3 duplicate");
  });
  it("filters out zero-count reasons but keeps the rest", () => {
    expect(
      formatSkipBreakdown({
        invoice_locked: 4,
        duplicate: 0,
        no_user_mapping: 1,
      }),
    ).toBe("4 invoice_locked · 1 no_user_mapping");
  });
});

describe("sourceLabel", () => {
  it("formats Harvest without identifier", () => {
    expect(
      sourceLabel({ imported_from: "harvest", source_account_identifier: null }),
    ).toBe("Harvest");
  });
  it("formats Harvest with identifier", () => {
    expect(
      sourceLabel({
        imported_from: "harvest",
        source_account_identifier: "123456",
      }),
    ).toBe("Harvest · 123456");
  });
  it("capitalizes unknown providers as a fallback", () => {
    expect(
      sourceLabel({
        imported_from: "toggl",
        source_account_identifier: null,
      }),
    ).toBe("Toggl");
  });
  it("formats csv-expenses cleanly", () => {
    expect(
      sourceLabel({
        imported_from: "csv-expenses",
        source_account_identifier: null,
      }),
    ).toBe("Expenses CSV");
  });
});

describe("canRenderUndo", () => {
  it("hides button when already undone", () => {
    expect(
      canRenderUndo(
        { undone_at: "2026-04-23", status: "completed" },
        true,
      ),
    ).toBe(false);
  });
  it("hides button on running imports (wait for it to finish)", () => {
    expect(canRenderUndo({ undone_at: null, status: "running" }, true)).toBe(
      false,
    );
  });
  it("hides button when caller isn't an admin", () => {
    expect(
      canRenderUndo({ undone_at: null, status: "completed" }, false),
    ).toBe(false);
  });
  it("shows button on completed runs for admins", () => {
    expect(
      canRenderUndo({ undone_at: null, status: "completed" }, true),
    ).toBe(true);
  });
  it("shows button on failed runs for admins (so they can clean up partial writes)", () => {
    expect(canRenderUndo({ undone_at: null, status: "failed" }, true)).toBe(
      true,
    );
  });
});
