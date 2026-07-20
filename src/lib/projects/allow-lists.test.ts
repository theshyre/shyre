import { describe, it, expect } from "vitest";
import {
  ALLOWED_BUDGET_PERIODS,
  ALLOWED_BUDGET_CARRYOVER,
  PROJECT_STATUSES,
  ALLOWED_PROJECT_STATUSES,
  SELECTABLE_PROJECT_STATUSES,
  LIVE_PROJECT_STATUSES,
  TERMINAL_PROJECT_STATUSES,
  isProjectClosed,
} from "./allow-lists";

// Constraint ↔ allow-list parity with the SQL CHECK constraints is
// enforced centrally by src/__tests__/db-parity.test.ts; this covers
// the membership + derived-set semantics the project actions and
// edit form rely on.
describe("ALLOWED_BUDGET_PERIODS", () => {
  it("accepts weekly, monthly, quarterly", () => {
    for (const p of ["weekly", "monthly", "quarterly"]) {
      expect(ALLOWED_BUDGET_PERIODS.has(p)).toBe(true);
    }
    expect(ALLOWED_BUDGET_PERIODS.has("daily")).toBe(false);
  });
});

describe("ALLOWED_BUDGET_CARRYOVER", () => {
  it("accepts none, within_quarter, lifetime", () => {
    for (const c of ["none", "within_quarter", "lifetime"]) {
      expect(ALLOWED_BUDGET_CARRYOVER.has(c)).toBe(true);
    }
    expect(ALLOWED_BUDGET_CARRYOVER.has("rollover")).toBe(false);
  });
});

describe("PROJECT_STATUSES / ALLOWED_PROJECT_STATUSES", () => {
  it("has exactly the four lifecycle statuses in display order", () => {
    expect(PROJECT_STATUSES).toEqual([
      "active",
      "paused",
      "completed",
      "archived",
    ]);
  });

  it("ALLOWED_PROJECT_STATUSES mirrors PROJECT_STATUSES as a Set", () => {
    for (const s of PROJECT_STATUSES) {
      expect(ALLOWED_PROJECT_STATUSES.has(s)).toBe(true);
    }
    expect(ALLOWED_PROJECT_STATUSES.has("closed")).toBe(false);
  });
});

describe("SELECTABLE_PROJECT_STATUSES", () => {
  it("only exposes active and paused — terminal states are excluded", () => {
    expect(SELECTABLE_PROJECT_STATUSES).toEqual(["active", "paused"]);
    expect(SELECTABLE_PROJECT_STATUSES).not.toContain("completed");
    expect(SELECTABLE_PROJECT_STATUSES).not.toContain("archived");
  });
});

describe("LIVE_PROJECT_STATUSES / TERMINAL_PROJECT_STATUSES", () => {
  it("partitions all four statuses with no overlap", () => {
    for (const s of PROJECT_STATUSES) {
      const live = LIVE_PROJECT_STATUSES.has(s);
      const terminal = TERMINAL_PROJECT_STATUSES.has(s);
      expect(live !== terminal).toBe(true);
    }
    expect(LIVE_PROJECT_STATUSES.has("active")).toBe(true);
    expect(LIVE_PROJECT_STATUSES.has("paused")).toBe(true);
    expect(TERMINAL_PROJECT_STATUSES.has("completed")).toBe(true);
    expect(TERMINAL_PROJECT_STATUSES.has("archived")).toBe(true);
  });
});

describe("isProjectClosed", () => {
  it("is true only for 'completed'", () => {
    expect(isProjectClosed("completed")).toBe(true);
  });

  it("is false for other statuses, null, and undefined", () => {
    expect(isProjectClosed("active")).toBe(false);
    expect(isProjectClosed("paused")).toBe(false);
    expect(isProjectClosed("archived")).toBe(false);
    expect(isProjectClosed(null)).toBe(false);
    expect(isProjectClosed(undefined)).toBe(false);
  });
});
