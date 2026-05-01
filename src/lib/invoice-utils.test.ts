import { describe, it, expect } from "vitest";
import {
  calculateLineItemAmount,
  calculateInvoiceTotals,
  generateInvoiceNumber,
  formatCurrency,
  minutesToHours,
} from "./invoice-utils";
import type { LineItemResult } from "./invoice-utils";

describe("invoice-utils", () => {
  describe("calculateLineItemAmount", () => {
    it("multiplies quantity by unit price", () => {
      expect(calculateLineItemAmount(2, 150)).toBe(300);
    });

    it("rounds to 2 decimal places", () => {
      // 1.5 * 133.33 = 199.995, rounds to 200.00
      expect(calculateLineItemAmount(1.5, 133.33)).toBe(200);
      // 1.33 * 75 = 99.75
      expect(calculateLineItemAmount(1.33, 75)).toBe(99.75);
    });

    it("handles zero quantity", () => {
      expect(calculateLineItemAmount(0, 100)).toBe(0);
    });

    it("handles fractional hours", () => {
      expect(calculateLineItemAmount(0.25, 200)).toBe(50);
    });
  });

  describe("calculateInvoiceTotals", () => {
    const lineItems: LineItemResult[] = [
      { description: "Dev work", quantity: 10, unitPrice: 150, amount: 1500 },
      { description: "Design", quantity: 5, unitPrice: 100, amount: 500 },
    ];

    it("sums line items for subtotal", () => {
      const totals = calculateInvoiceTotals(lineItems, 0);
      expect(totals.subtotal).toBe(2000);
    });

    it("calculates tax amount", () => {
      const totals = calculateInvoiceTotals(lineItems, 10);
      expect(totals.taxAmount).toBe(200);
    });

    it("calculates total with tax", () => {
      const totals = calculateInvoiceTotals(lineItems, 10);
      expect(totals.total).toBe(2200);
    });

    it("handles 0% tax", () => {
      const totals = calculateInvoiceTotals(lineItems, 0);
      expect(totals.taxAmount).toBe(0);
      expect(totals.total).toBe(2000);
    });

    it("handles empty line items", () => {
      const totals = calculateInvoiceTotals([], 10);
      expect(totals.subtotal).toBe(0);
      expect(totals.taxAmount).toBe(0);
      expect(totals.total).toBe(0);
    });

    it("rounds to avoid floating point issues", () => {
      const items: LineItemResult[] = [
        { description: "Work", quantity: 1.1, unitPrice: 99.99, amount: 109.99 },
      ];
      const totals = calculateInvoiceTotals(items, 8.25);
      expect(totals.taxAmount).toBe(9.07);
      expect(totals.total).toBe(119.06);
    });

    describe("discount", () => {
      it("subtracts a flat discount amount", () => {
        const totals = calculateInvoiceTotals(lineItems, 0, { amount: 100 });
        expect(totals.subtotal).toBe(2000);
        expect(totals.discountAmount).toBe(100);
        expect(totals.total).toBe(1900);
      });

      it("computes discount from a rate when amount isn't given", () => {
        const totals = calculateInvoiceTotals(lineItems, 0, { rate: 10 });
        expect(totals.discountRate).toBe(10);
        expect(totals.discountAmount).toBe(200);
        expect(totals.total).toBe(1800);
      });

      it("100% discount drops total to $0 (the user's import case)", () => {
        // Real bug that drove this: a Harvest invoice with a 100%
        // pro-bono discount imported as $0 across the board with no
        // record of the discount. Now: subtotal stays, discount
        // recorded, total = 0.
        const totals = calculateInvoiceTotals(lineItems, 0, { rate: 100 });
        expect(totals.subtotal).toBe(2000);
        expect(totals.discountAmount).toBe(2000);
        expect(totals.discountRate).toBe(100);
        expect(totals.total).toBe(0);
      });

      it("clamps discount at subtotal — total never goes negative", () => {
        const totals = calculateInvoiceTotals(lineItems, 0, { amount: 5000 });
        expect(totals.discountAmount).toBe(2000);
        expect(totals.total).toBe(0);
      });

      it("applies tax AFTER discount (US norm; matches QBO + Harvest)", () => {
        // Subtotal 2000 - 200 discount = 1800 taxable.
        // Tax 10% × 1800 = 180. Total = 1980 (NOT 2000 - 200 + 200).
        const totals = calculateInvoiceTotals(lineItems, 10, { rate: 10 });
        expect(totals.discountAmount).toBe(200);
        expect(totals.taxAmount).toBe(180);
        expect(totals.total).toBe(1980);
      });

      it("0% / no discount preserves prior behavior (regression)", () => {
        const totals = calculateInvoiceTotals(lineItems, 10);
        expect(totals.discountAmount).toBe(0);
        expect(totals.discountRate).toBeNull();
        expect(totals.total).toBe(2200);
      });

      it("explicit amount wins over rate when both are passed", () => {
        const totals = calculateInvoiceTotals(lineItems, 0, {
          amount: 50,
          rate: 10,
        });
        expect(totals.discountAmount).toBe(50);
        // discountRate stays null because the amount won — the rate
        // wasn't the source of truth on this row.
        expect(totals.discountRate).toBeNull();
      });

      it("rounds the rate × subtotal computation at penny boundaries", () => {
        // 99.99 × 33% = 32.9967 — round to 33.00.
        const items: LineItemResult[] = [
          { description: "Work", quantity: 1, unitPrice: 99.99, amount: 99.99 },
        ];
        const totals = calculateInvoiceTotals(items, 0, { rate: 33 });
        expect(totals.discountAmount).toBe(33);
        expect(totals.total).toBe(66.99);
      });
    });
  });

  describe("generateInvoiceNumber", () => {
    it("formats with prefix, year, and padded number", () => {
      expect(generateInvoiceNumber("INV", 1, 2026)).toBe("INV-2026-001");
    });

    it("pads numbers to 3 digits", () => {
      expect(generateInvoiceNumber("INV", 42, 2026)).toBe("INV-2026-042");
    });

    it("handles numbers over 999", () => {
      expect(generateInvoiceNumber("INV", 1234, 2026)).toBe("INV-2026-1234");
    });

    it("uses custom prefix", () => {
      expect(generateInvoiceNumber("BILL", 7, 2026)).toBe("BILL-2026-007");
    });

    it("defaults to current year when not provided", () => {
      const result = generateInvoiceNumber("INV", 1);
      const currentYear = new Date().getFullYear();
      expect(result).toContain(String(currentYear));
    });
  });

  describe("formatCurrency", () => {
    it("defaults to USD with thousands grouping and 2 decimals", () => {
      expect(formatCurrency(1500)).toBe("$1,500.00");
    });

    it("formats fractional amounts", () => {
      expect(formatCurrency(99.5)).toBe("$99.50");
    });

    it("formats zero", () => {
      expect(formatCurrency(0)).toBe("$0.00");
    });

    it("uses the explicit currency code", () => {
      // Intl uses NBSP between code/symbol and amount in en-US for
      // some currencies — assert on the meaningful tokens not the
      // exact whitespace.
      expect(formatCurrency(50, "EUR")).toMatch(/€/);
      expect(formatCurrency(50, "GBP")).toMatch(/£/);
    });

    it("normalizes lowercase currency codes", () => {
      expect(formatCurrency(10, "usd")).toBe("$10.00");
    });

    it("falls back to a code-prefixed string for invalid codes", () => {
      // Intl rejects codes that aren't 3 ASCII letters with RangeError;
      // the helper should swallow that and produce a useful string.
      expect(formatCurrency(10, "BAD!")).toBe("BAD! 10.00");
    });
  });

  describe("minutesToHours", () => {
    it("converts 60 minutes to 1 hour", () => {
      expect(minutesToHours(60)).toBe(1);
    });

    it("converts 90 minutes to 1.5 hours", () => {
      expect(minutesToHours(90)).toBe(1.5);
    });

    it("rounds to 2 decimal places", () => {
      expect(minutesToHours(100)).toBe(1.67);
    });

    it("handles zero", () => {
      expect(minutesToHours(0)).toBe(0);
    });
  });
});
