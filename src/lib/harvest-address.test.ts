import { describe, it, expect } from "vitest";
import {
  parseHarvestAddress,
  parseHarvestAddressForStorage,
} from "./harvest-address";

describe("parseHarvestAddress", () => {
  it("parses the canonical 2-line US address", () => {
    // The shape that triggered the bug — "6119 Canter Ln\nWest Linn, OR 97068"
    // was landing entirely in `street`.
    const got = parseHarvestAddress("6119 Canter Ln\nWest Linn, OR 97068");
    expect(got.street).toBe("6119 Canter Ln");
    expect(got.city).toBe("West Linn");
    expect(got.state).toBe("OR");
    expect(got.postalCode).toBe("97068");
    expect(got.street2).toBe("");
    expect(got.country).toBe("");
  });

  it("parses an address with a suite line", () => {
    const got = parseHarvestAddress(
      "1234 Main St\nSuite 200\nBrooklyn, NY 11201",
    );
    expect(got.street).toBe("1234 Main St");
    expect(got.street2).toBe("Suite 200");
    expect(got.city).toBe("Brooklyn");
    expect(got.state).toBe("NY");
    expect(got.postalCode).toBe("11201");
  });

  it("peels off a US country tail line", () => {
    const got = parseHarvestAddress(
      "1234 Main St\nBrooklyn, NY 11201\nUSA",
    );
    expect(got.street).toBe("1234 Main St");
    expect(got.city).toBe("Brooklyn");
    expect(got.state).toBe("NY");
    expect(got.postalCode).toBe("11201");
    expect(got.country).toBe("US");
  });

  it("recognizes an ISO-2 country code on its own line", () => {
    const got = parseHarvestAddress(
      "10 Downing St\nLondon SW1A 2AA\nGB",
    );
    expect(got.country).toBe("GB");
  });

  it("recognizes a country name on its own line", () => {
    const got = parseHarvestAddress(
      "1234 Rue Saint-Denis\nMontréal, QC H2X 3J3\nCanada",
    );
    expect(got.country).toBe("CA");
  });

  it("handles 5+4 ZIP codes", () => {
    const got = parseHarvestAddress(
      "742 Evergreen Terrace\nSpringfield, OR 97477-1234",
    );
    expect(got.postalCode).toBe("97477-1234");
  });

  it("handles a city/state with no postal code", () => {
    const got = parseHarvestAddress("100 Office Tower\nSeattle, WA");
    expect(got.city).toBe("Seattle");
    expect(got.state).toBe("WA");
    expect(got.postalCode).toBe("");
  });

  it("merges three+ pre-city lines into street + street2", () => {
    const got = parseHarvestAddress(
      "Acme Corp\nAttn: Accounts Payable\n1234 Main St\nBrooklyn, NY 11201",
    );
    expect(got.street).toBe("Acme Corp");
    expect(got.street2).toBe("Attn: Accounts Payable, 1234 Main St");
    expect(got.city).toBe("Brooklyn");
  });

  it("treats a single-line input as either a city-line or street", () => {
    const cityOnly = parseHarvestAddress("Brooklyn, NY 11201");
    expect(cityOnly.city).toBe("Brooklyn");
    expect(cityOnly.state).toBe("NY");
    expect(cityOnly.postalCode).toBe("11201");

    const streetOnly = parseHarvestAddress("1234 Main St");
    expect(streetOnly.street).toBe("1234 Main St");
    expect(streetOnly.city).toBe("");
  });

  it("returns all-empty for null / empty / whitespace input via storage helper", () => {
    expect(parseHarvestAddressForStorage(null)).toBeNull();
    expect(parseHarvestAddressForStorage("")).toBeNull();
    expect(parseHarvestAddressForStorage("   \n  \n")).toBeNull();
  });

  it("survives a single line with no recognizable structure (puts it in street)", () => {
    const got = parseHarvestAddress("PO Box 47");
    expect(got.street).toBe("PO Box 47");
    expect(got.city).toBe("");
  });

  it("does not eat a city line as country (commas/digits guard)", () => {
    // "Brooklyn, NY 11201" must NOT be peeled off as country —
    // it has a comma + digits, the country guard blocks it.
    const got = parseHarvestAddress(
      "1234 Main St\nBrooklyn, NY 11201",
    );
    expect(got.country).toBe("");
    expect(got.city).toBe("Brooklyn");
  });

  it("handles \\r\\n line endings (Windows-format Harvest exports)", () => {
    const got = parseHarvestAddress(
      "6119 Canter Ln\r\nWest Linn, OR 97068",
    );
    expect(got.street).toBe("6119 Canter Ln");
    expect(got.city).toBe("West Linn");
  });
});

describe("parseHarvestAddressForStorage", () => {
  it("returns a JSON string suitable for the customers.address column", () => {
    const json = parseHarvestAddressForStorage(
      "6119 Canter Ln\nWest Linn, OR 97068",
    );
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json!);
    expect(parsed.street).toBe("6119 Canter Ln");
    expect(parsed.city).toBe("West Linn");
    expect(parsed.state).toBe("OR");
    expect(parsed.postalCode).toBe("97068");
  });
});
