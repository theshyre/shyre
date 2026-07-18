import { describe, it, expect } from "vitest";
import { summarizeCollectedPayments } from "./collected-revenue";

describe("summarizeCollectedPayments", () => {
  it("buckets per currency — NEVER sums across currencies", () => {
    const out = summarizeCollectedPayments([
      { amount: 100, currency: "USD", customerName: "Acme" },
      { amount: 250.5, currency: "USD", customerName: "Acme" },
      { amount: 900, currency: "CAD", customerName: "Maple" },
    ]);
    expect(out).toHaveLength(2);
    const usd = out.find((b) => b.currency === "USD")!;
    expect(usd.total).toBe(350.5);
    expect(usd.paymentCount).toBe(2);
    expect(out.find((b) => b.currency === "CAD")!.total).toBe(900);
  });

  it("rolls up by client within a currency, largest first", () => {
    const out = summarizeCollectedPayments([
      { amount: 100, currency: "USD", customerName: "Small" },
      { amount: 500, currency: "USD", customerName: "Big" },
    ]);
    expect(out[0]!.byClient.map((c) => c.customerName)).toEqual([
      "Big",
      "Small",
    ]);
  });

  it("defaults blank currency to USD and rounds to cents", () => {
    const out = summarizeCollectedPayments([
      { amount: 0.105, currency: "", customerName: "X" },
      { amount: 0.105, currency: "usd", customerName: "X" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.currency).toBe("USD");
    expect(out[0]!.total).toBe(0.21);
  });

  it("empty input → empty buckets", () => {
    expect(summarizeCollectedPayments([])).toEqual([]);
  });
});
