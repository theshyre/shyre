import { describe, it, expect } from "vitest";
import {
  addressSchema,
  serializeAddress,
  deserializeAddress,
  formatAddressOneLine,
  formatAddressMultiLine,
  COUNTRIES,
  type Address,
} from "./address";

const empty: Address = {
  street: "",
  street2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
};

const fullUS: Address = {
  street: "123 Main St",
  street2: "Apt 4",
  city: "Portland",
  state: "OR",
  postalCode: "97201",
  country: "US",
};

describe("addressSchema", () => {
  it("defaults missing keys to empty strings", () => {
    const parsed = addressSchema.parse({});
    expect(parsed).toEqual(empty);
  });

  it("rejects strings exceeding the max length", () => {
    expect(() =>
      addressSchema.parse({ street: "x".repeat(201) }),
    ).toThrow();
  });

  it("accepts a full address", () => {
    expect(addressSchema.parse(fullUS)).toEqual(fullUS);
  });
});

describe("serializeAddress", () => {
  it("returns null when every field is empty", () => {
    expect(serializeAddress(empty)).toBeNull();
  });

  it("returns JSON when at least one field has content", () => {
    const out = serializeAddress({ ...empty, city: "Portland" });
    expect(out).not.toBeNull();
    expect(JSON.parse(out!)).toEqual({ ...empty, city: "Portland" });
  });
});

describe("deserializeAddress", () => {
  it("returns the empty record for null input", () => {
    expect(deserializeAddress(null)).toEqual(empty);
  });

  it("parses JSON-shaped input back into an Address", () => {
    const json = JSON.stringify(fullUS);
    expect(deserializeAddress(json)).toEqual(fullUS);
  });

  it("falls back to street-only for legacy plain-text input", () => {
    const result = deserializeAddress("123 Old Format Lane");
    expect(result.street).toBe("123 Old Format Lane");
    expect(result.city).toBe("");
  });

  it("returns the empty record for an empty string", () => {
    expect(deserializeAddress("")).toEqual(empty);
  });
});

describe("formatAddressOneLine", () => {
  it("joins all populated parts with commas", () => {
    expect(formatAddressOneLine(fullUS)).toBe(
      "123 Main St, Apt 4, Portland, OR 97201, United States",
    );
  });

  it("collapses to state-only when postalCode is empty", () => {
    const a = { ...fullUS, postalCode: "" };
    expect(formatAddressOneLine(a)).toContain("OR");
    expect(formatAddressOneLine(a)).not.toContain("OR ,");
  });

  it("collapses to postal-only when state is empty", () => {
    const a = { ...fullUS, state: "" };
    expect(formatAddressOneLine(a)).toContain("97201");
  });

  it("returns the empty string when every field is empty", () => {
    expect(formatAddressOneLine(empty)).toBe("");
  });

  it("falls back to the country code when not in COUNTRIES", () => {
    const a = { ...empty, country: "ZZ" };
    expect(formatAddressOneLine(a)).toBe("ZZ");
  });
});

describe("formatAddressMultiLine", () => {
  it("renders each component on its own line, with city/state/postal joined", () => {
    const lines = formatAddressMultiLine(fullUS);
    expect(lines[0]).toBe("123 Main St");
    expect(lines[1]).toBe("Apt 4");
    expect(lines[2]).toBe("Portland, OR, 97201");
    expect(lines[3]).toBe("United States");
  });

  it("omits empty lines", () => {
    expect(formatAddressMultiLine(empty)).toEqual([]);
  });

  it("renders only city when state and postal are missing", () => {
    const lines = formatAddressMultiLine({
      ...empty,
      city: "Lisbon",
      country: "PT",
    });
    expect(lines).toEqual(["Lisbon", "Portugal"]);
  });
});

describe("COUNTRIES", () => {
  it("starts with US for US-first ordering", () => {
    expect(COUNTRIES[0]?.code).toBe("US");
  });

  it("uses ISO 3166-1 alpha-2 codes", () => {
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("has unique country codes", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
