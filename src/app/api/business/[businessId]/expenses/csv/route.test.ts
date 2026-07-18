import { escapeCsvField } from "@/lib/time/csv";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Queue-per-table thenable builder — the route awaits filter chains
// directly. Filter calls are recorded so tests can assert the
// business-scoping behavior (team .in()) without replaying the whole
// chain order.
interface Result {
  data: unknown;
  error: unknown;
}
let queues: Record<string, Result[]> = {};
let filters: Array<{ table: string; method: string; args: unknown[] }> = [];

interface Builder extends PromiseLike<Result> {
  select: (cols?: string) => Builder;
  eq: (col: string, val: unknown) => Builder;
  in: (col: string, vals: unknown[]) => Builder;
  is: (col: string, val: unknown) => Builder;
  gte: (col: string, val: unknown) => Builder;
  lte: (col: string, val: unknown) => Builder;
  or: (clause: string) => Builder;
  order: (col: string, opts?: unknown) => Builder;
}

function makeBuilder(table: string): Builder {
  const resolve = (): Result =>
    queues[table]?.shift() ?? { data: null, error: null };
  const track =
    (method: string) =>
    (...args: unknown[]): Builder => {
      filters.push({ table, method, args });
      return builder;
    };
  const builder: Builder = {
    select: track("select"),
    eq: track("eq"),
    in: track("in"),
    is: track("is"),
    gte: track("gte"),
    lte: track("lte"),
    or: track("or"),
    order: track("order"),
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

function ctx(businessId = "biz-1"): { params: Promise<{ businessId: string }> } {
  return { params: Promise.resolve({ businessId }) };
}

function expenseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "exp-1",
    team_id: "team-1",
    user_id: "u1",
    incurred_on: "2026-06-15",
    amount: 120.5,
    currency: "usd",
    vendor: "Delta",
    external_reference: "TRIP-42",
    category: "travel",
    description: "Flight to client, one-way",
    notes: null,
    project_id: "proj-1",
    billable: true,
    imported_from: null,
    imported_at: null,
    created_at: "2026-06-15T12:00:00+00:00",
    deleted_at: null,
    projects: {
      name: "Website",
      customer_id: "cust-1",
      customers: { name: "Acme" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  queues = {};
  filters = [];
  mockGetUser.mockReset();
  logErrorMock.mockClear();
});

describe("GET /api/business/[businessId]/expenses/csv", () => {
  it("returns 401 without a session — expense data never leaves for anonymous callers", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/expenses/csv"),
      ctx(),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("returns 500 and logs when the business-teams lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["teams"] = [{ data: null, error: { message: "boom" } }];
    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/expenses/csv"),
      ctx(),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Export failed");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      url: "/api/business/biz-1/expenses/csv",
      action: "exportExpenses.teams",
    });
  });

  it("returns an empty header-only CSV when the caller can see no teams under the business", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["teams"] = [{ data: [], error: null }];
    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/expenses/csv"),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(await res.text()).toBe("expense_id\n");
    // No expenses query was ever issued — nothing to leak.
    expect(filters.some((f) => f.table === "expenses")).toBe(false);
  });

  it("exports rows scoped to the business's teams, with reconciliation columns and quoting", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["teams"] = [
      { data: [{ id: "team-1" }, { id: "team-2" }], error: null },
      // Second teams query: loadTeamNames.
      {
        data: [
          { id: "team-1", name: "Malcom IO" },
          { id: "team-2", name: "Side, Team" },
        ],
        error: null,
      },
    ];
    queues["expenses"] = [{ data: [expenseRow()], error: null }];

    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/expenses/csv"),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="shyre-expenses-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.text();
    const lines = body.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "expense_id,incurred_on,team,team_id,vendor,amount,currency,category,billable,project,project_id,customer,customer_id,description,notes,external_reference,imported_from,imported_at,created_at,deleted_at,user_id,business_id",
    );
    expect(lines).toHaveLength(2);
    const row = lines[1] ?? "";
    expect(row).toContain("exp-1,2026-06-15,Malcom IO,team-1,Delta,120.5,USD,travel,true,Website,proj-1,Acme,cust-1");
    // Comma inside the description → RFC-4180 quoted.
    expect(row).toContain('"Flight to client, one-way"');
    expect(row).toContain("biz-1");

    // The expenses query was constrained to the business's team ids —
    // the URL's businessId can't over-fetch across other businesses.
    const teamScope = filters.find(
      (f) => f.table === "expenses" && f.method === "in",
    );
    expect(teamScope?.args).toEqual(["team_id", ["team-1", "team-2"]]);
    // Default (no includeDeleted=1) excludes soft-deleted rows.
    const deletedFilter = filters.find(
      (f) => f.table === "expenses" && f.method === "is",
    );
    expect(deletedFilter?.args).toEqual(["deleted_at", null]);
  });

  it("honors the page's filters: date range, multi-category, billable, project=none, escaped free-text q", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["teams"] = [
      { data: [{ id: "team-1" }], error: null },
      { data: [{ id: "team-1", name: "Malcom IO" }], error: null },
    ];
    queues["expenses"] = [{ data: [], error: null }];

    const res = await GET(
      new Request(
        "https://shyre.test/api/business/biz-1/expenses/csv?from=2026-01-01&to=2026-06-30&category=travel,meals&billable=1&project=none&q=100%25",
      ),
      ctx(),
    );
    expect(res.status).toBe(200);

    const expFilters = filters.filter((f) => f.table === "expenses");
    expect(expFilters).toContainEqual({
      table: "expenses",
      method: "gte",
      args: ["incurred_on", "2026-01-01"],
    });
    expect(expFilters).toContainEqual({
      table: "expenses",
      method: "lte",
      args: ["incurred_on", "2026-06-30"],
    });
    // Comma-joined categories → .in()
    expect(expFilters).toContainEqual({
      table: "expenses",
      method: "in",
      args: ["category", ["travel", "meals"]],
    });
    expect(expFilters).toContainEqual({
      table: "expenses",
      method: "eq",
      args: ["billable", true],
    });
    // project=none → IS NULL, not eq
    expect(expFilters).toContainEqual({
      table: "expenses",
      method: "is",
      args: ["project_id", null],
    });
    // "100%" is escaped so ILIKE doesn't wildcard-match every row.
    const orFilter = expFilters.find((f) => f.method === "or");
    expect(orFilter).toBeDefined();
    expect(String(orFilter!.args[0])).toContain("%100\\%%");
  });

  it("returns 500 and logs when the expenses query fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["teams"] = [{ data: [{ id: "team-1" }], error: null }];
    queues["expenses"] = [
      { data: null, error: { message: "permission denied" } },
    ];
    const res = await GET(
      new Request(
        "https://shyre.test/api/business/biz-1/expenses/csv?team=team-1",
      ),
      ctx(),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Export failed");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      teamId: "team-1",
      url: "/api/business/biz-1/expenses/csv",
      action: "exportExpenses",
    });
  });

  it("formula-leading vendor/description cells are escaped in the export (SAL-048)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["teams"] = [
      { data: [{ id: "team-1" }], error: null },
      { data: [{ id: "team-1", name: "Malcom IO" }], error: null },
    ];
    queues["expenses"] = [
      {
        data: [
          expenseRow({
            vendor: '=HYPERLINK("http://evil")',
            description: "@SUM(A1)",
          }),
        ],
        error: null,
      },
    ];
    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/expenses/csv"),
      ctx(),
    );
    const body = await res.text();
    // Apostrophe-prefixed, so spreadsheets treat them as text.
    expect(body).toContain("'=HYPERLINK");
    expect(body).toContain("'@SUM(A1)");
    // And the shared sanitizer is the mechanism (pin the contract).
    expect(escapeCsvField("=1+2")).toBe("'=1+2");
  });
});
