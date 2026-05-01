import { describe, it, expect } from "vitest";
import {
  isPresetTermsDays,
  paymentTermsLabel,
  resolvePaymentTermsDays,
  resolvePaymentTermsSource,
  computeDueDate,
  PAYMENT_TERMS_PRESETS,
} from "./payment-terms";

describe("isPresetTermsDays", () => {
  it("matches each canonical preset", () => {
    for (const p of PAYMENT_TERMS_PRESETS) {
      expect(isPresetTermsDays(p)).toBe(true);
    }
  });

  it("rejects non-presets", () => {
    expect(isPresetTermsDays(7)).toBe(false);
    expect(isPresetTermsDays(31)).toBe(false);
    expect(isPresetTermsDays(120)).toBe(false);
  });

  it("rejects null / undefined", () => {
    expect(isPresetTermsDays(null)).toBe(false);
    expect(isPresetTermsDays(undefined)).toBe(false);
  });
});

describe("paymentTermsLabel", () => {
  it("0 → Due on receipt", () => {
    expect(paymentTermsLabel(0)).toBe("Due on receipt");
  });

  it("positive → Net N", () => {
    expect(paymentTermsLabel(30)).toBe("Net 30");
    expect(paymentTermsLabel(15)).toBe("Net 15");
    expect(paymentTermsLabel(90)).toBe("Net 90");
  });

  it("null → null (no terms)", () => {
    expect(paymentTermsLabel(null)).toBeNull();
  });
});

describe("resolvePaymentTermsDays", () => {
  it("customer override wins", () => {
    expect(
      resolvePaymentTermsDays({
        customerTermsDays: 15,
        teamDefaultDays: 30,
      }),
    ).toBe(15);
  });

  it("falls back to team default when customer is null", () => {
    expect(
      resolvePaymentTermsDays({
        customerTermsDays: null,
        teamDefaultDays: 30,
      }),
    ).toBe(30);
  });

  it("falls back to null when both are null", () => {
    expect(
      resolvePaymentTermsDays({
        customerTermsDays: null,
        teamDefaultDays: null,
      }),
    ).toBeNull();
  });

  it("treats 0 (Due on receipt) as a valid customer override", () => {
    expect(
      resolvePaymentTermsDays({
        customerTermsDays: 0,
        teamDefaultDays: 30,
      }),
    ).toBe(0);
  });
});

describe("resolvePaymentTermsSource", () => {
  it("customer override → 'customer'", () => {
    expect(
      resolvePaymentTermsSource({
        customerTermsDays: 15,
        teamDefaultDays: 30,
      }),
    ).toBe("customer");
  });

  it("team-only → 'team'", () => {
    expect(
      resolvePaymentTermsSource({
        customerTermsDays: null,
        teamDefaultDays: 30,
      }),
    ).toBe("team");
  });

  it("neither → 'none'", () => {
    expect(
      resolvePaymentTermsSource({
        customerTermsDays: null,
        teamDefaultDays: null,
      }),
    ).toBe("none");
  });
});

describe("computeDueDate", () => {
  it("Net 30 from 2026-04-01 → 2026-05-01", () => {
    expect(computeDueDate("2026-04-01", 30)).toBe("2026-05-01");
  });

  it("Net 0 (Due on receipt) returns the issue date", () => {
    expect(computeDueDate("2026-04-01", 0)).toBe("2026-04-01");
  });

  it("crosses year boundary correctly", () => {
    expect(computeDueDate("2026-12-15", 30)).toBe("2027-01-14");
  });

  it("Net 90 from 2026-01-01 → 2026-04-01", () => {
    expect(computeDueDate("2026-01-01", 90)).toBe("2026-04-01");
  });

  it("handles leap years (2028 is a leap year)", () => {
    expect(computeDueDate("2028-02-29", 1)).toBe("2028-03-01");
  });
});
