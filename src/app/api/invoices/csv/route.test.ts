import { escapeCsvField } from "@/lib/time/csv";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Queue-per-table thenable builder — the route awaits filter chains
// directly (no .single()/.maybeSingle() terminals in this handler).
interface Result {
  data: unknown;
  error: unknown;
}
let queues: Record<string, Result[]> = {};

interface Builder extends PromiseLike<Result> {
  select: (cols?: string) => Builder;
  eq: (col: string, val: unknown) => Builder;
  in: (col: string, vals: unknown[]) => Builder;
  gte: (col: string, val: unknown) => Builder;
  lte: (col: string, val: unknown) => Builder;
  order: (col: string, opts?: unknown) => Builder;
}

function makeBuilder(table: string): Builder {
  const resolve = (): Result =>
    queues[table]?.shift() ?? { data: null, error: null };
  const builder: Builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    then: (onF, onR) => Promise.resolve(resolve()).then(onF, onR),
  };
  return builder;
}

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => makeBuilder(table),
  }),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

import { GET } from "./route";

function invoiceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "inv-1",
    invoice_number: "INV-2026-014",
    status: "sent",
    issued_date: "2026-06-01",
    due_date: null,
    sent_at: "2026-06-01T09:00:00+00:00",
    paid_at: null,
    voided_at: null,
    subtotal: 1000,
    tax_rate: 8.5,
    tax_amount: 85,
    discount_rate: null,
    discount_amount: null,
    total: 1085,
    currency: "USD",
    notes: null,
    imported_from: null,
    customer_id: "cust-1",
    customers: { name: "EyeReg", email: "ap@eyereg.example" },
    team_id: "team-1",
    ...overrides,
  };
}

beforeEach(() => {
  queues = {};
  mockGetUser.mockReset();
  logErrorMock.mockClear();
});

describe("GET /api/invoices/csv", () => {
  it("returns 401 without a session — money data never leaves for anonymous callers", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(new Request("https://shyre.test/api/invoices/csv"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("exports rows with reconciliation columns; same-currency payments reduce amount_due, cross-currency ones don't", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["invoices"] = [{ data: [invoiceRow()], error: null }];
    queues["teams"] = [
      { data: [{ id: "team-1", name: "Malcom IO" }], error: null },
    ];
    queues["invoice_payments"] = [
      {
        data: [
          { invoice_id: "inv-1", amount: 500, currency: "USD" },
          // A CAD payment must NOT reduce the USD balance (no FX capture).
          { invoice_id: "inv-1", amount: 585, currency: "CAD" },
        ],
        error: null,
      },
    ];

    const res = await GET(new Request("https://shyre.test/api/invoices/csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="shyre-invoices-\d{4}-\d{2}-\d{2}\.csv"/,
    );

    const body = await res.text();
    const lines = body.trimEnd().split("\n");
    expect(lines[0]).toContain("invoice_id,invoice_number,team,customer");
    expect(lines).toHaveLength(2);
    const row = lines[1] ?? "";
    expect(row).toContain("INV-2026-014");
    expect(row).toContain("Malcom IO");
    expect(row).toContain("EyeReg");
    // payments_total counts ONLY the USD payment; amount_due = 1085 - 500.
    expect(row).toContain(",500.00,585.00,");
  });

  it("returns 500 and logs when the invoices query fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["invoices"] = [{ data: null, error: { message: "boom" } }];
    const res = await GET(
      new Request("https://shyre.test/api/invoices/csv?org=team-1"),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Export failed");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      teamId: "team-1",
      action: "exportInvoices",
    });
  });

  it("formula-leading fields are escaped in the export (SAL-048)", () => {
    // The route funnels every cell through escapeCsvField, which (since
    // SAL-048) apostrophe-prefixes leading = + - @ on string inputs.
    expect(escapeCsvField("=HYPERLINK(\"http://evil\")")).toMatch(/^"'=/);
    expect(escapeCsvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});
