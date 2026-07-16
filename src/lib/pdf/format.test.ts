import { describe, it, expect } from "vitest";
import {
  makeFmt,
  safeHex,
  parseDateOnly,
  formatPdfDate,
  addressLinesForBlock,
} from "./format";
import { serializeAddress } from "@/lib/schemas/address";

describe("makeFmt", () => {
  it("formats USD", () => {
    expect(makeFmt("USD")(1234.5)).toBe("$1,234.50");
  });
  it("falls back to CODE N.NN on unknown codes", () => {
    expect(makeFmt("ZZZ")(10)).toMatch(/ZZZ.*10\.00|10\.00.*ZZZ/);
  });
  it("defaults empty to USD", () => {
    expect(makeFmt("")(1)).toBe("$1.00");
  });
});

describe("safeHex", () => {
  it("accepts 3- and 6-digit hex", () => {
    expect(safeHex("#abc")).toBe("#abc");
    expect(safeHex("#A1B2C3")).toBe("#A1B2C3");
  });
  it("rejects garbage and null", () => {
    expect(safeHex("red")).toBeNull();
    expect(safeHex("#12345")).toBeNull();
    expect(safeHex(null)).toBeNull();
    expect(safeHex(undefined)).toBeNull();
  });
});

describe("parseDateOnly", () => {
  it("parses YYYY-MM-DD as UTC midnight", () => {
    const d = parseDateOnly("2026-07-16");
    expect(d?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });
  it("parses full ISO timestamps", () => {
    expect(parseDateOnly("2026-07-16T12:30:00Z")).not.toBeNull();
  });
  it("returns null on garbage", () => {
    expect(parseDateOnly("not a date")).toBeNull();
  });
});

describe("formatPdfDate", () => {
  it("prints date-only strings without timezone shifting", () => {
    expect(formatPdfDate("2026-07-16")).toBe("07/16/2026");
  });
  it("handles null and garbage", () => {
    expect(formatPdfDate(null)).toBe("—");
    expect(formatPdfDate("garbage")).toBe("—");
  });
});

describe("addressLinesForBlock", () => {
  // country is an ISO 3166-1 alpha-2 code; the formatter maps it to the
  // display name ("US" → "United States").
  const address = serializeAddress({
    street: "123 Main St",
    street2: "",
    city: "Springfield",
    state: "IL",
    postalCode: "62704",
    country: "US",
  });

  it("hides the country line by default", () => {
    const lines = addressLinesForBlock(address, false);
    expect(lines.some((l) => l.includes("United States"))).toBe(false);
    expect(lines.some((l) => l.includes("Springfield"))).toBe(true);
  });

  it("shows the country when asked", () => {
    const lines = addressLinesForBlock(address, true);
    expect(lines.some((l) => l.includes("United States"))).toBe(true);
  });

  it("never drops a single-line legacy address", () => {
    const lines = addressLinesForBlock("123 Legacy Rd", false);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("handles null", () => {
    expect(addressLinesForBlock(null, false)).toEqual([]);
  });
});
