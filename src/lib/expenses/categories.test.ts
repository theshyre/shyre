import { describe, it, expect } from "vitest";
import { EXPENSE_CATEGORIES } from "./categories";
import { ALLOWED_EXPENSE_CATEGORIES } from "./allow-lists";

describe("EXPENSE_CATEGORIES", () => {
  it("contains no duplicates", () => {
    expect(new Set(EXPENSE_CATEGORIES).size).toBe(EXPENSE_CATEGORIES.length);
  });

  it("stays in parity with ALLOWED_EXPENSE_CATEGORIES (UI list ↔ action allow-list)", () => {
    // The UI dropdowns render EXPENSE_CATEGORIES; the server actions
    // validate against ALLOWED_EXPENSE_CATEGORIES. Drift means the UI
    // offers a value the action rejects (broken UX) or the action
    // accepts a value the UI can't render (orphaned data).
    expect(new Set(EXPENSE_CATEGORIES)).toEqual(ALLOWED_EXPENSE_CATEGORIES);
  });

  it('keeps "other" as a member — the recategorize flow and the warning-tint chip depend on it', () => {
    expect(EXPENSE_CATEGORIES).toContain("other");
  });
});
