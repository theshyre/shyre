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
