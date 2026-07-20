import { describe, it, expect } from "vitest";
import { escapeCsvField } from "./escape";

describe("escapeCsvField", () => {
  it("passes through simple text", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes fields with commas", () => {
    expect(escapeCsvField("a, b")).toBe('"a, b"');
  });

  it("quotes fields with newlines", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("doubles embedded quotes", () => {
    expect(escapeCsvField('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("stringifies numbers and booleans", () => {
    expect(escapeCsvField(42)).toBe("42");
    expect(escapeCsvField(true)).toBe("true");
    expect(escapeCsvField(false)).toBe("false");
  });
});

describe("escapeCsvField — formula-injection defense (SAL-048)", () => {
  it("prefixes leading formula triggers on strings with a quote", () => {
    expect(escapeCsvField("=HYPERLINK(\"http://evil\")")).toBe(
      "\"'=HYPERLINK(\"\"http://evil\"\")\"",
    );
    expect(escapeCsvField("+1234")).toBe("'+1234");
    expect(escapeCsvField("-cmd")).toBe("'-cmd");
    expect(escapeCsvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("leaves numbers, booleans, and ordinary strings untouched", () => {
    expect(escapeCsvField(-42.5)).toBe("-42.5");
    expect(escapeCsvField(true)).toBe("true");
    expect(escapeCsvField("Acme Corp")).toBe("Acme Corp");
    expect(escapeCsvField("")).toBe("");
  });
});
