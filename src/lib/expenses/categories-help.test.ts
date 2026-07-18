import { describe, it, expect, vi } from "vitest";
import { getCategoryHelp, getAllCategoryHelp } from "./categories-help";
import { EXPENSE_CATEGORIES } from "./categories";

// Echo translator — returns the key so tests can assert the exact
// i18n lookup paths without loading real bundles.
const echoT = (key: string): string => key;

describe("getCategoryHelp", () => {
  it("resolves description and examples under categoryHelp.<category>", () => {
    expect(getCategoryHelp("software", echoT)).toEqual({
      description: "categoryHelp.software.description",
      examples: "categoryHelp.software.examples",
    });
  });

  it("passes no interpolation values (keys are static per category)", () => {
    const t = vi.fn(echoT);
    getCategoryHelp("travel", t);
    expect(t).toHaveBeenCalledWith("categoryHelp.travel.description");
    expect(t).toHaveBeenCalledWith("categoryHelp.travel.examples");
  });
});

describe("getAllCategoryHelp", () => {
  it("returns one entry per category, in canonical order", () => {
    const all = getAllCategoryHelp(echoT);
    expect(all.map((e) => e.category)).toEqual([...EXPENSE_CATEGORIES]);
    for (const entry of all) {
      expect(entry.description).toBe(
        `categoryHelp.${entry.category}.description`,
      );
      expect(entry.examples).toBe(`categoryHelp.${entry.category}.examples`);
    }
  });
});
