import { describe, it, expect } from "vitest";
import {
  blankToNull,
  requiredString,
  optionalInt,
  readPersonFields,
} from "./people-form-parse";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("blankToNull", () => {
  it("returns null for null input", () => {
    expect(blankToNull(null)).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(blankToNull("")).toBeNull();
  });
  it("returns null for whitespace", () => {
    expect(blankToNull("   ")).toBeNull();
  });
  it("trims and returns a real value", () => {
    expect(blankToNull("  hello  ")).toBe("hello");
  });
});

describe("requiredString", () => {
  it("returns the trimmed value when present", () => {
    expect(requiredString(fd({ x: "  v  " }), "x")).toBe("v");
  });
  it("throws when blank", () => {
    expect(() => requiredString(fd({ x: "   " }), "x")).toThrow(/required/);
  });
  it("throws when missing", () => {
    expect(() => requiredString(fd({}), "x")).toThrow(/required/);
  });
});

describe("optionalInt", () => {
  it("returns null for blank", () => {
    expect(optionalInt(null)).toBeNull();
    expect(optionalInt("")).toBeNull();
  });
  it("parses valid integers", () => {
    expect(optionalInt("42")).toBe(42);
    expect(optionalInt("0")).toBe(0);
  });
  it("rejects decimals", () => {
    expect(() => optionalInt("1.5")).toThrow(/Invalid integer/);
  });
  it("rejects negatives", () => {
    expect(() => optionalInt("-5")).toThrow(/Invalid integer/);
  });
  it("rejects non-numeric", () => {
    expect(() => optionalInt("abc")).toThrow(/Invalid integer/);
  });
});

describe("readPersonFields", () => {
  const baseRequired = {
    legal_name: "Robert Smith",
    employment_type: "w2_employee",
  };

  it("parses a minimal valid record", () => {
    const out = readPersonFields(fd(baseRequired));
    expect(out.legal_name).toBe("Robert Smith");
    expect(out.employment_type).toBe("w2_employee");
    expect(out.user_id).toBeNull();
    expect(out.compensation_amount_cents).toBeNull();
  });

  it("throws when legal_name is missing", () => {
    expect(() =>
      readPersonFields(fd({ employment_type: "w2_employee" })),
    ).toThrow(/legal_name is required/);
  });

  it("throws when employment_type is missing", () => {
    expect(() =>
      readPersonFields(fd({ legal_name: "Robert Smith" })),
    ).toThrow(/employment_type is required/);
  });

  it("rejects unknown employment_type", () => {
    expect(() =>
      readPersonFields(
        fd({ ...baseRequired, employment_type: "pirate" }),
      ),
    ).toThrow(/Invalid employment_type/);
  });

  it("rejects unknown compensation_type", () => {
    expect(() =>
      readPersonFields(
        fd({ ...baseRequired, compensation_type: "vibes" }),
      ),
    ).toThrow(/Invalid compensation_type/);
  });

  it("rejects unknown compensation_schedule", () => {
    expect(() =>
      readPersonFields(
        fd({ ...baseRequired, compensation_schedule: "fortnightly" }),
      ),
    ).toThrow(/Invalid compensation_schedule/);
  });

  it("converts compensation_amount dollars to integer cents", () => {
    const out = readPersonFields(
      fd({ ...baseRequired, compensation_amount: "150000" }),
    );
    expect(out.compensation_amount_cents).toBe(15000000);
  });

  it("handles fractional dollar amounts", () => {
    const out = readPersonFields(
      fd({ ...baseRequired, compensation_amount: "1234.56" }),
    );
    expect(out.compensation_amount_cents).toBe(123456);
  });

  it("rejects a negative compensation amount", () => {
    expect(() =>
      readPersonFields(
        fd({ ...baseRequired, compensation_amount: "-1" }),
      ),
    ).toThrow(/Invalid compensation_amount/);
  });

  it("uppercases the state code", () => {
    const out = readPersonFields(fd({ ...baseRequired, state: "ca" }));
    expect(out.state).toBe("CA");
  });

  it("rejects a non-USPS state code", () => {
    expect(() =>
      readPersonFields(fd({ ...baseRequired, state: "California" })),
    ).toThrow(/two-letter USPS code/);
  });

  it("leaves state null when blank", () => {
    const out = readPersonFields(fd(baseRequired));
    expect(out.state).toBeNull();
  });

  it("preserves all optional fields when provided", () => {
    const out = readPersonFields(
      fd({
        ...baseRequired,
        user_id: "user-123",
        preferred_name: "Bob",
        work_email: "bob@work.example",
        work_phone: "+1-555-0100",
        title: "Principal",
        department: "Delivery",
        employee_number: "E-007",
        started_on: "2024-01-15",
        ended_on: "2025-12-31",
        compensation_type: "salary",
        compensation_amount: "120000",
        compensation_currency: "USD",
        compensation_schedule: "annual",
        address_line1: "1 Market St",
        address_line2: "Suite 400",
        city: "San Francisco",
        state: "CA",
        postal_code: "94105",
        country: "US",
        reports_to_person_id: "person-42",
        notes: "hired via referral",
      }),
    );
    expect(out).toMatchObject({
      user_id: "user-123",
      preferred_name: "Bob",
      work_email: "bob@work.example",
      title: "Principal",
      employee_number: "E-007",
      compensation_amount_cents: 12000000,
      compensation_schedule: "annual",
      state: "CA",
      reports_to_person_id: "person-42",
    });
  });
});
