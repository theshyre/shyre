import { describe, expect, it } from "vitest";
import {
  agingBucket,
  splitCollectedRevenue,
  summarizeOutstanding,
} from "./compute";

describe("splitCollectedRevenue", () => {
  it("apportions a full payment into ex-tax revenue + tax by the invoice ratio", () => {
    // Invoice: subtotal 1000, no discount, 10% tax → tax 100, total 1100.
    const { collectedByCurrency, revenueByCurrency, taxByCurrency } =
      splitCollectedRevenue([
        {
          amount: 1100,
          currency: "USD",
          invoiceSubtotal: 1000,
          invoiceDiscount: 0,
          invoiceTaxAmount: 100,
          invoiceTotal: 1100,
        },
      ]);
    expect(collectedByCurrency.get("USD")).toBe(1100);
    expect(revenueByCurrency.get("USD")).toBe(1000);
    expect(taxByCurrency.get("USD")).toBe(100);
  });

  it("apportions a PARTIAL payment proportionally (tax is not fully recognized early)", () => {
    // Same invoice, but only 550 of 1100 paid → half of each.
    const { collectedByCurrency, revenueByCurrency, taxByCurrency } =
      splitCollectedRevenue([
        {
          amount: 550,
          currency: "USD",
          invoiceSubtotal: 1000,
          invoiceDiscount: 0,
          invoiceTaxAmount: 100,
          invoiceTotal: 1100,
        },
      ]);
    expect(collectedByCurrency.get("USD")).toBe(550);
    expect(revenueByCurrency.get("USD")).toBe(500);
    expect(taxByCurrency.get("USD")).toBe(50);
  });

  it("honors discount before tax in the ratio", () => {
    // subtotal 1000, discount 200 → taxable base 800, 10% tax 80, total 880.
    const { revenueByCurrency, taxByCurrency } = splitCollectedRevenue([
      {
        amount: 880,
        currency: "USD",
        invoiceSubtotal: 1000,
        invoiceDiscount: 200,
        invoiceTaxAmount: 80,
        invoiceTotal: 880,
      },
    ]);
    expect(revenueByCurrency.get("USD")).toBe(800);
    expect(taxByCurrency.get("USD")).toBe(80);
  });

  it("never sums across currencies", () => {
    const { collectedByCurrency } = splitCollectedRevenue([
      {
        amount: 100,
        currency: "USD",
        invoiceSubtotal: 100,
        invoiceDiscount: 0,
        invoiceTaxAmount: 0,
        invoiceTotal: 100,
      },
      {
        amount: 200,
        currency: "eur",
        invoiceSubtotal: 200,
        invoiceDiscount: 0,
        invoiceTaxAmount: 0,
        invoiceTotal: 200,
      },
    ]);
    expect(collectedByCurrency.get("USD")).toBe(100);
    expect(collectedByCurrency.get("EUR")).toBe(200);
    expect(collectedByCurrency.size).toBe(2);
  });

  it("treats a zero-total invoice's payment as pure ex-tax revenue (no divide-by-zero)", () => {
    const { revenueByCurrency, taxByCurrency } = splitCollectedRevenue([
      {
        amount: 50,
        currency: "USD",
        invoiceSubtotal: 0,
        invoiceDiscount: 0,
        invoiceTaxAmount: 0,
        invoiceTotal: 0,
      },
    ]);
    expect(revenueByCurrency.get("USD")).toBe(50);
    expect(taxByCurrency.get("USD")).toBe(0);
  });
});

describe("agingBucket", () => {
  const today = new Date("2026-07-21T12:00:00Z");

  it("returns current for a null due date or a future/today due date", () => {
    expect(agingBucket(null, today)).toBe("current");
    expect(agingBucket("2026-08-01", today)).toBe("current");
    expect(agingBucket("2026-07-21", today)).toBe("current");
  });

  it("buckets by days past due", () => {
    expect(agingBucket("2026-07-20", today)).toBe("d1_30"); // 1 day
    expect(agingBucket("2026-06-21", today)).toBe("d1_30"); // 30 days
    expect(agingBucket("2026-06-20", today)).toBe("d31_60"); // 31 days
    expect(agingBucket("2026-05-21", today)).toBe("d61_90"); // 61 days
    expect(agingBucket("2026-05-01", today)).toBe("d61_90"); // 81 days
    expect(agingBucket("2026-04-21", today)).toBe("d90_plus"); // 91 days
  });
});

describe("summarizeOutstanding", () => {
  const today = new Date("2026-07-21T12:00:00Z");

  it("totals amount due per currency and buckets by aging", () => {
    const { totalByCurrency, agingByCurrency } = summarizeOutstanding(
      [
        { amountDue: 1000, currency: "USD", dueDate: "2026-08-01" }, // current
        { amountDue: 500, currency: "USD", dueDate: "2026-07-10" }, // 11 days
        { amountDue: 300, currency: "EUR", dueDate: "2026-04-01" }, // 90+
      ],
      today,
    );
    expect(totalByCurrency.get("USD")).toBe(1500);
    expect(totalByCurrency.get("EUR")).toBe(300);
    expect(agingByCurrency.get("USD")?.current).toBe(1000);
    expect(agingByCurrency.get("USD")?.d1_30).toBe(500);
    expect(agingByCurrency.get("EUR")?.d90_plus).toBe(300);
  });

  it("skips fully-paid / overpaid rows", () => {
    const { totalByCurrency } = summarizeOutstanding(
      [
        { amountDue: 0, currency: "USD", dueDate: "2026-07-01" },
        { amountDue: -25, currency: "USD", dueDate: "2026-07-01" },
        { amountDue: 100, currency: "USD", dueDate: "2026-07-01" },
      ],
      today,
    );
    expect(totalByCurrency.get("USD")).toBe(100);
  });
});
