import { describe, it, expect } from "vitest";
import {
  buildInvoiceCsvRow,
  INVOICE_CSV_HEADERS,
  type InvoiceCsvRowInput,
} from "./invoice-csv";

const baseInput: InvoiceCsvRowInput = {
  id: "inv-1",
  invoice_number: "INV-0042",
  status: "sent",
  issued_date: "2026-04-01",
  due_date: "2026-04-15",
  sent_at: "2026-04-01T15:00:00Z",
  paid_at: null,
  voided_at: null,
  subtotal: 1000,
  tax_rate: 8.25,
  tax_amount: 82.5,
  discount_rate: null,
  discount_amount: 0,
  total: 1082.5,
  payments_total: 0,
  currency: "USD",
  notes: "Net 15",
  imported_from: null,
  team_id: "team-a",
  customer_id: "cust-1",
  customer_name: "Acme",
  customer_email: "ap@acme.test",
};

const teamNames = new Map([["team-a", "Acme Consulting"]]);

describe("buildInvoiceCsvRow", () => {
  it("maps every column from the input row", () => {
    const row = buildInvoiceCsvRow(baseInput, teamNames, "2026-04-10");
    expect(row.invoice_id).toBe("inv-1");
    expect(row.invoice_number).toBe("INV-0042");
    expect(row.team).toBe("Acme Consulting");
    expect(row.customer).toBe("Acme");
    expect(row.customer_email).toBe("ap@acme.test");
    expect(row.customer_id).toBe("cust-1");
    expect(row.team_id).toBe("team-a");
    expect(row.status).toBe("sent");
    expect(row.issued_date).toBe("2026-04-01");
    expect(row.due_date).toBe("2026-04-15");
    expect(row.sent_at).toBe("2026-04-01T15:00:00Z");
    expect(row.paid_at).toBe("");
    expect(row.voided_at).toBe("");
    expect(row.subtotal).toBe("1000");
    expect(row.tax_rate).toBe("8.25");
    expect(row.tax_amount).toBe("82.5");
    expect(row.discount_amount).toBe("0");
    expect(row.discount_rate).toBe("");
    expect(row.total).toBe("1082.5");
    expect(row.payments_total).toBe("0.00");
    expect(row.amount_due).toBe("1082.50");
    expect(row.imported_from).toBe("");
    expect(row.notes).toBe("Net 15");
    expect(row.currency).toBe("USD");
  });

  it("uppercases the currency and falls back to USD when null", () => {
    expect(
      buildInvoiceCsvRow(
        { ...baseInput, currency: "eur" },
        teamNames,
        "2026-04-10",
      ).currency,
    ).toBe("EUR");
    expect(
      buildInvoiceCsvRow(
        { ...baseInput, currency: null },
        teamNames,
        "2026-04-10",
      ).currency,
    ).toBe("USD");
  });

  it("projects sent → overdue when due_date < today", () => {
    const row = buildInvoiceCsvRow(baseInput, teamNames, "2026-04-20");
    expect(row.status).toBe("overdue");
  });

  it("does not re-project paid / void / draft / already-overdue rows", () => {
    expect(
      buildInvoiceCsvRow(
        { ...baseInput, status: "paid" },
        teamNames,
        "2026-05-01",
      ).status,
    ).toBe("paid");
    expect(
      buildInvoiceCsvRow(
        { ...baseInput, status: "void" },
        teamNames,
        "2026-05-01",
      ).status,
    ).toBe("void");
  });

  it("renders nullable money columns as empty string (not 'null')", () => {
    const row = buildInvoiceCsvRow(
      {
        ...baseInput,
        subtotal: null,
        tax_rate: null,
        tax_amount: null,
        total: null,
        discount_rate: null,
        discount_amount: null,
      },
      teamNames,
      "2026-04-10",
    );
    expect(row.subtotal).toBe("");
    expect(row.tax_rate).toBe("");
    expect(row.tax_amount).toBe("");
    expect(row.total).toBe("");
    expect(row.discount_amount).toBe("");
  });

  it("falls back to empty team name when the lookup misses", () => {
    const row = buildInvoiceCsvRow(
      { ...baseInput, team_id: "team-missing" },
      teamNames,
      "2026-04-10",
    );
    expect(row.team).toBe("");
  });

  it("renders missing dates as empty string", () => {
    const row = buildInvoiceCsvRow(
      { ...baseInput, issued_date: null, due_date: null },
      teamNames,
      "2026-04-10",
    );
    expect(row.issued_date).toBe("");
    expect(row.due_date).toBe("");
    // Status doesn't get auto-overdue projected without a due_date.
    expect(row.status).toBe("sent");
  });

  it("preserves imported_from when present (so QuickBooks reconciliation can flag Harvest rows)", () => {
    const row = buildInvoiceCsvRow(
      { ...baseInput, imported_from: "harvest" },
      teamNames,
      "2026-04-10",
    );
    expect(row.imported_from).toBe("harvest");
  });

  it("preserves numeric strings that come from the DB driver verbatim", () => {
    // Supabase ships NUMERIC as string by default; the helper must
    // accept either shape and normalize to string.
    const row = buildInvoiceCsvRow(
      {
        ...baseInput,
        subtotal: "1000.00",
        tax_amount: "82.50",
        total: "1082.50",
      },
      teamNames,
      "2026-04-10",
    );
    expect(row.subtotal).toBe("1000.00");
    expect(row.tax_amount).toBe("82.50");
    expect(row.total).toBe("1082.50");
  });

  it("computes amount_due as total minus payments_total", () => {
    const row = buildInvoiceCsvRow(
      { ...baseInput, total: 1000, payments_total: 250 },
      teamNames,
      "2026-04-10",
    );
    expect(row.payments_total).toBe("250.00");
    expect(row.amount_due).toBe("750.00");
  });

  it("emits 0.00 amount_due when fully paid", () => {
    const row = buildInvoiceCsvRow(
      {
        ...baseInput,
        total: 1082.5,
        payments_total: 1082.5,
        status: "paid",
        paid_at: "2026-04-12T10:00:00Z",
      },
      teamNames,
      "2026-04-20",
    );
    expect(row.amount_due).toBe("0.00");
    expect(row.paid_at).toBe("2026-04-12T10:00:00Z");
    expect(row.status).toBe("paid");
  });

  it("renders an empty customer_email when null", () => {
    const row = buildInvoiceCsvRow(
      { ...baseInput, customer_email: null },
      teamNames,
      "2026-04-10",
    );
    expect(row.customer_email).toBe("");
  });
});

describe("INVOICE_CSV_HEADERS", () => {
  it("matches the column set buildInvoiceCsvRow returns", () => {
    const row = buildInvoiceCsvRow(baseInput, teamNames, "2026-04-10");
    const rowKeys = Object.keys(row).sort();
    const headers = [...INVOICE_CSV_HEADERS].sort();
    expect(rowKeys).toEqual(headers);
  });
});
