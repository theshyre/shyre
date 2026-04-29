import { describe, it, expect } from "vitest";
import {
  formatExpenseAmount,
  formatExpenseDateDisplay,
} from "./format-helpers";

describe("formatExpenseDateDisplay", () => {
  it("formats a valid ISO date as Mmm D, YYYY", () => {
    expect(formatExpenseDateDisplay("2019-12-16")).toBe("Dec 16, 2019");
  });

  it("formats a January date with single-digit day correctly", () => {
    expect(formatExpenseDateDisplay("2019-01-01")).toBe("Jan 1, 2019");
  });

  it("returns input verbatim for non-ISO shapes", () => {
    expect(formatExpenseDateDisplay("12/16/2019")).toBe("12/16/2019");
    expect(formatExpenseDateDisplay("yesterday")).toBe("yesterday");
    expect(formatExpenseDateDisplay("")).toBe("");
  });

  it("returns input verbatim when month/day are out of range", () => {
    expect(formatExpenseDateDisplay("2019-13-01")).toBe("2019-13-01");
    expect(formatExpenseDateDisplay("2019-00-01")).toBe("2019-00-01");
    expect(formatExpenseDateDisplay("2019-12-32")).toBe("2019-12-32");
    expect(formatExpenseDateDisplay("2019-12-00")).toBe("2019-12-00");
  });

  it("renders UTC year, not local-shifted", () => {
    // 2019-01-01 UTC could shift to 2018-12-31 in negative-offset
    // zones if the formatter ran in local time. Lock UTC.
    expect(formatExpenseDateDisplay("2019-01-01")).toBe("Jan 1, 2019");
  });
});

describe("formatExpenseAmount", () => {
  it("formats USD with $ prefix", () => {
    expect(formatExpenseAmount(60, "USD")).toBe("$60.00");
  });

  it("formats EUR with € prefix or suffix per locale", () => {
    // en-US locale renders €60.00; we don't pin locale beyond that.
    const out = formatExpenseAmount(60, "EUR");
    expect(out).toMatch(/€/);
    expect(out).toContain("60");
  });

  it("uses thousands separator", () => {
    expect(formatExpenseAmount(8171.67, "USD")).toBe("$8,171.67");
  });

  it("falls back to plain string on bogus currency code", () => {
    // Intl.NumberFormat throws on invalid codes — fall back path.
    expect(formatExpenseAmount(60, "XYZ123BAD")).toMatch(/XYZ123BAD/);
  });
});
