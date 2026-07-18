import { describe, it, expect } from "vitest";
import { ALLOWED_INVOICE_GROUPING_MODES } from "./allow-lists";

describe("invoice allow-lists", () => {
  it("exposes the four grouping modes (Harvest vocabulary)", () => {
    expect(ALLOWED_INVOICE_GROUPING_MODES).toEqual(
      new Set(["by_task", "by_person", "by_project", "detailed"]),
    );
  });

  it("rejects values outside the set", () => {
    expect(ALLOWED_INVOICE_GROUPING_MODES.has("by_customer")).toBe(false);
    expect(ALLOWED_INVOICE_GROUPING_MODES.has("")).toBe(false);
  });
});
