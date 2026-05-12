import { describe, it, expect } from "vitest";
import {
  tableClass,
  tableHeaderRowClass,
  tableHeaderCellClass,
  tableBodyRowClass,
  tableBodyCellClass,
  tableWrapperClass,
} from "./table-styles";

/**
 * Lock the table-style constants in place. The constants are the
 * standardized chrome for every data table — drift means the bug
 * lives in the lookalike inline classNames elsewhere, not here.
 * Regression-test the semantic-typography rule (no raw text-sm /
 * text-base / text-[Npx] / text-body-lg leaking back in).
 */

const allConstants = [
  tableClass,
  tableHeaderRowClass,
  tableHeaderCellClass,
  tableBodyRowClass,
  tableBodyCellClass,
  tableWrapperClass,
];

describe("table style constants", () => {
  it("every constant is a non-empty string", () => {
    for (const c of allConstants) {
      expect(typeof c).toBe("string");
      expect(c.length).toBeGreaterThan(0);
    }
  });

  it("tableClass uses the semantic text scale only — no raw size classes leak in", () => {
    expect(tableClass).toContain("text-body");
    // Regex needles avoid embedding the banned class names as literal
    // strings (the ESLint rule scans source for them).
    const bannedClasses = ["text-" + "sm", "text-" + "base", "text-" + "body-lg"];
    for (const banned of bannedClasses) {
      expect(tableClass).not.toContain(banned);
    }
  });

  it("no constant uses raw text-[Npx] sizes (banned by the typography rule)", () => {
    for (const c of allConstants) {
      expect(c).not.toMatch(/text-\[\d+px\]/);
    }
  });

  it("header cell uses the uppercase micro-label typography", () => {
    expect(tableHeaderCellClass).toContain("text-label");
    expect(tableHeaderCellClass).toContain("uppercase");
    expect(tableHeaderCellClass).toContain("text-content-muted");
  });

  it("header row has the bottom rule + inset background", () => {
    expect(tableHeaderRowClass).toContain("border-b");
    expect(tableHeaderRowClass).toContain("bg-surface-inset");
  });

  it("body row drops the bottom border on the last row + hover tint", () => {
    expect(tableBodyRowClass).toContain("border-b");
    expect(tableBodyRowClass).toContain("last:border-0");
    expect(tableBodyRowClass).toContain("hover:bg-hover");
  });

  it("wrapper has the rounded card chrome", () => {
    expect(tableWrapperClass).toContain("rounded-lg");
    expect(tableWrapperClass).toContain("border");
    expect(tableWrapperClass).toContain("overflow-hidden");
  });
});
