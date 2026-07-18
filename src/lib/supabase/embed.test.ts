import { describe, it, expect } from "vitest";
import { unwrapEmbed } from "./embed";

interface Row {
  name: string;
}

describe("unwrapEmbed", () => {
  it("returns a plain object embed as-is", () => {
    const row: Row = { name: "Acme" };
    expect(unwrapEmbed<Row>(row)).toBe(row);
  });

  it("returns the first row of an array embed", () => {
    const first: Row = { name: "Acme" };
    expect(unwrapEmbed<Row>([first, { name: "Other" }])).toBe(first);
  });

  it("returns null for an empty array embed", () => {
    expect(unwrapEmbed<Row>([])).toBeNull();
  });

  it("returns null for null", () => {
    expect(unwrapEmbed<Row>(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(unwrapEmbed<Row>(undefined)).toBeNull();
  });

  it("does not confuse falsy-but-present values with absence", () => {
    expect(unwrapEmbed<string>("")).toBe("");
    expect(unwrapEmbed<number>(0)).toBe(0);
    expect(unwrapEmbed<boolean>(false)).toBe(false);
  });
});
