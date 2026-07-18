import { describe, it, expect } from "vitest";
import { dedupeVendors } from "./vendor-options";

describe("dedupeVendors", () => {
  it("returns an empty array for no input", () => {
    expect(dedupeVendors([])).toEqual([]);
  });

  it("drops null, undefined, and blank/whitespace-only values", () => {
    expect(
      dedupeVendors([null, undefined, "", "   ", "Apple"]),
    ).toEqual(["Apple"]);
  });

  it("trims surrounding whitespace before de-duping", () => {
    expect(dedupeVendors(["  Apple  ", "Apple"])).toEqual(["Apple"]);
  });

  it("de-dupes case-insensitively, keeping the first-seen spelling", () => {
    // "AWS" seen first → "aws" / "Aws" collapse onto it.
    expect(dedupeVendors(["AWS", "aws", "Aws"])).toEqual(["AWS"]);
  });

  it("sorts case-insensitively / alphabetically", () => {
    expect(dedupeVendors(["Zoom", "apple", "Notion"])).toEqual([
      "apple",
      "Notion",
      "Zoom",
    ]);
  });

  it("preserves distinct vendors that only differ beyond case", () => {
    const out = dedupeVendors(["Apple Store", "Apple", "AppNexus"]);
    expect(out).toEqual(["Apple", "Apple Store", "AppNexus"]);
  });

  it("does not mutate the input array", () => {
    const input = ["b", "a", "a"];
    dedupeVendors(input);
    expect(input).toEqual(["b", "a", "a"]);
  });
});
