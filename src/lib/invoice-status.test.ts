import { describe, it, expect } from "vitest";
import {
  INVOICE_STATUSES,
  isInvoiceStatus,
  isValidInvoiceStatusTransition,
  allowedNextStatuses,
  effectiveInvoiceStatus,
} from "./invoice-status";

describe("isInvoiceStatus", () => {
  it("accepts every value in INVOICE_STATUSES", () => {
    for (const s of INVOICE_STATUSES) {
      expect(isInvoiceStatus(s)).toBe(true);
    }
  });

  it("rejects unknown values + empty + casing", () => {
    expect(isInvoiceStatus("")).toBe(false);
    expect(isInvoiceStatus("DRAFT")).toBe(false);
    expect(isInvoiceStatus("partial")).toBe(false);
  });
});

describe("isValidInvoiceStatusTransition", () => {
  it("draft → sent | void are allowed", () => {
    expect(isValidInvoiceStatusTransition("draft", "sent")).toBe(true);
    expect(isValidInvoiceStatusTransition("draft", "void")).toBe(true);
  });

  it("draft → paid is rejected (must go through sent first)", () => {
    expect(isValidInvoiceStatusTransition("draft", "paid")).toBe(false);
  });

  it("sent → paid | void | overdue are allowed", () => {
    expect(isValidInvoiceStatusTransition("sent", "paid")).toBe(true);
    expect(isValidInvoiceStatusTransition("sent", "void")).toBe(true);
    expect(isValidInvoiceStatusTransition("sent", "overdue")).toBe(true);
  });

  it("sent → draft is rejected (would silently unwind)", () => {
    expect(isValidInvoiceStatusTransition("sent", "draft")).toBe(false);
  });

  it("overdue → paid | void allowed; overdue → sent rejected", () => {
    expect(isValidInvoiceStatusTransition("overdue", "paid")).toBe(true);
    expect(isValidInvoiceStatusTransition("overdue", "void")).toBe(true);
    expect(isValidInvoiceStatusTransition("overdue", "sent")).toBe(false);
    expect(isValidInvoiceStatusTransition("overdue", "draft")).toBe(false);
  });

  it("paid is terminal — every transition is rejected", () => {
    for (const next of INVOICE_STATUSES) {
      expect(isValidInvoiceStatusTransition("paid", next)).toBe(false);
    }
  });

  it("void is terminal — every transition is rejected", () => {
    for (const next of INVOICE_STATUSES) {
      expect(isValidInvoiceStatusTransition("void", next)).toBe(false);
    }
  });

  it("same-status no-ops are rejected (likely a UI bug)", () => {
    for (const s of INVOICE_STATUSES) {
      expect(isValidInvoiceStatusTransition(s, s)).toBe(false);
    }
  });

  it("rejects unknown current or next values", () => {
    expect(isValidInvoiceStatusTransition("DRAFT", "sent")).toBe(false);
    expect(isValidInvoiceStatusTransition("draft", "DELIVERED")).toBe(false);
    expect(isValidInvoiceStatusTransition("", "sent")).toBe(false);
  });
});

describe("effectiveInvoiceStatus", () => {
  it("projects sent → overdue when due_date < today", () => {
    expect(effectiveInvoiceStatus("sent", "2026-04-15", "2026-04-20")).toBe(
      "overdue",
    );
  });

  it("keeps sent as sent when due_date == today (not yet past)", () => {
    expect(effectiveInvoiceStatus("sent", "2026-04-20", "2026-04-20")).toBe(
      "sent",
    );
  });

  it("keeps sent as sent when due_date > today", () => {
    expect(effectiveInvoiceStatus("sent", "2026-04-25", "2026-04-20")).toBe(
      "sent",
    );
  });

  it("keeps sent as sent when due_date is null (no due date set)", () => {
    expect(effectiveInvoiceStatus("sent", null, "2026-04-20")).toBe("sent");
  });

  it("never re-projects paid, void, draft, or already-overdue rows", () => {
    expect(effectiveInvoiceStatus("paid", "2026-04-15", "2026-04-20")).toBe(
      "paid",
    );
    expect(effectiveInvoiceStatus("void", "2026-04-15", "2026-04-20")).toBe(
      "void",
    );
    expect(effectiveInvoiceStatus("draft", "2026-04-15", "2026-04-20")).toBe(
      "draft",
    );
    expect(effectiveInvoiceStatus("overdue", "2026-04-25", "2026-04-20")).toBe(
      "overdue",
    );
  });

  it("falls back to draft for unknown stored status (data corruption)", () => {
    expect(effectiveInvoiceStatus("partial", null, "2026-04-20")).toBe(
      "draft",
    );
  });
});

describe("allowedNextStatuses", () => {
  it("returns the correct outgoing edges per status", () => {
    expect(allowedNextStatuses("draft").sort()).toEqual(["sent", "void"]);
    expect(allowedNextStatuses("sent").sort()).toEqual([
      "overdue",
      "paid",
      "void",
    ]);
    expect(allowedNextStatuses("overdue").sort()).toEqual(["paid", "void"]);
  });

  it("returns empty for terminal statuses", () => {
    expect(allowedNextStatuses("paid")).toEqual([]);
    expect(allowedNextStatuses("void")).toEqual([]);
  });

  it("returns empty for unknown statuses", () => {
    expect(allowedNextStatuses("partial")).toEqual([]);
    expect(allowedNextStatuses("")).toEqual([]);
  });
});
