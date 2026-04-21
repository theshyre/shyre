import { describe, it, expect } from "vitest";
import {
  blankToNull,
  requiredString,
  optionalInt,
  validateStateCode,
  validateMmDd,
  readStateRegistrationFields,
  readTaxRegistrationFields,
} from "./registrations-form-parse";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("blankToNull (registrations)", () => {
  it("returns null for null / blank / whitespace", () => {
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("   ")).toBeNull();
  });
  it("trims and preserves real values", () => {
    expect(blankToNull("  x  ")).toBe("x");
  });
});

describe("requiredString (registrations)", () => {
  it("returns the value when present", () => {
    expect(requiredString(fd({ x: "y" }), "x")).toBe("y");
  });
  it("throws when missing or blank", () => {
    expect(() => requiredString(fd({}), "x")).toThrow(/required/);
    expect(() => requiredString(fd({ x: "  " }), "x")).toThrow(/required/);
  });
});

describe("optionalInt (registrations)", () => {
  it("parses, rejects fractions / negatives / garbage", () => {
    expect(optionalInt("100")).toBe(100);
    expect(optionalInt(null)).toBeNull();
    expect(() => optionalInt("1.2")).toThrow();
    expect(() => optionalInt("-1")).toThrow();
    expect(() => optionalInt("hello")).toThrow();
  });
});

describe("validateStateCode", () => {
  it("accepts two-letter uppercase codes", () => {
    expect(() => validateStateCode("CA")).not.toThrow();
    expect(() => validateStateCode("DE")).not.toThrow();
  });
  it("rejects lowercase, single letters, full names, empty", () => {
    expect(() => validateStateCode("ca")).toThrow();
    expect(() => validateStateCode("C")).toThrow();
    expect(() => validateStateCode("California")).toThrow();
    expect(() => validateStateCode("")).toThrow();
  });
});

describe("validateMmDd", () => {
  it("allows null", () => {
    expect(() => validateMmDd(null)).not.toThrow();
  });
  it("accepts valid MM-DD", () => {
    expect(() => validateMmDd("01-01")).not.toThrow();
    expect(() => validateMmDd("12-31")).not.toThrow();
    expect(() => validateMmDd("06-15")).not.toThrow();
  });
  it("rejects malformed values", () => {
    expect(() => validateMmDd("1-1")).toThrow();
    expect(() => validateMmDd("13-01")).toThrow();
    expect(() => validateMmDd("01-32")).toThrow();
    expect(() => validateMmDd("abcde")).toThrow();
  });
});

describe("readStateRegistrationFields", () => {
  // registration_type is no longer a form input — it's derived from
  // is_formation (the UX simplification that removed the redundant
  // dropdown to avoid conflicting with the formation checkbox).
  const base = { state: "DE" };

  it("parses a minimal valid record (unchecked → foreign_qualification)", () => {
    const out = readStateRegistrationFields(fd(base));
    expect(out.state).toBe("DE");
    expect(out.registration_type).toBe("foreign_qualification");
    expect(out.is_formation).toBe(false);
    expect(out.registration_status).toBe("pending");
  });

  it("uppercases the state code", () => {
    const out = readStateRegistrationFields(
      fd({ ...base, state: "de" }),
    );
    expect(out.state).toBe("DE");
  });

  it("derives registration_type from is_formation when checked", () => {
    const out = readStateRegistrationFields(
      fd({ ...base, is_formation: "true" }),
    );
    expect(out.is_formation).toBe(true);
    expect(out.registration_type).toBe("domestic");
  });

  it("derives registration_type = foreign_qualification when unchecked", () => {
    const out = readStateRegistrationFields(fd(base));
    expect(out.registration_type).toBe("foreign_qualification");
  });

  it("rejects an invalid state code", () => {
    expect(() =>
      readStateRegistrationFields(fd({ ...base, state: "California" })),
    ).toThrow(/two-letter USPS code/);
  });

  it("rejects an invalid registration_status", () => {
    expect(() =>
      readStateRegistrationFields(
        fd({ ...base, registration_status: "mythical" }),
      ),
    ).toThrow(/Invalid registration_status/);
  });

  it("rejects an invalid report_frequency when set", () => {
    expect(() =>
      readStateRegistrationFields(
        fd({ ...base, report_frequency: "fortnightly" }),
      ),
    ).toThrow(/Invalid report_frequency/);
  });

  it("rejects an invalid due_rule when set", () => {
    expect(() =>
      readStateRegistrationFields(fd({ ...base, due_rule: "random" })),
    ).toThrow(/Invalid due_rule/);
  });

  it("rejects malformed annual_report_due_mmdd", () => {
    expect(() =>
      readStateRegistrationFields(
        fd({ ...base, annual_report_due_mmdd: "13-40" }),
      ),
    ).toThrow(/MM-DD/);
  });
});

describe("readTaxRegistrationFields", () => {
  const base = { state: "CA", tax_type: "sales_use" };

  it("parses a minimal valid record", () => {
    const out = readTaxRegistrationFields(fd(base));
    expect(out.state).toBe("CA");
    expect(out.tax_type).toBe("sales_use");
    expect(out.tax_registration_status).toBe("pending");
  });

  it("rejects an invalid tax_type", () => {
    expect(() =>
      readTaxRegistrationFields(fd({ ...base, tax_type: "vat" })),
    ).toThrow(/Invalid tax_type/);
  });

  it("rejects an invalid tax_registration_status", () => {
    expect(() =>
      readTaxRegistrationFields(
        fd({ ...base, tax_registration_status: "mythical" }),
      ),
    ).toThrow(/Invalid tax_registration_status/);
  });

  it("rejects an invalid filing_frequency when set", () => {
    expect(() =>
      readTaxRegistrationFields(
        fd({ ...base, filing_frequency: "whenever" }),
      ),
    ).toThrow(/Invalid filing_frequency/);
  });

  it("uppercases the state code", () => {
    const out = readTaxRegistrationFields(fd({ ...base, state: "ca" }));
    expect(out.state).toBe("CA");
  });
});
