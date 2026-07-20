import { escapeCsvField } from "@/lib/csv/escape";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Queue-per-table thenable builder (same style as the proposals/action
// harnesses) — the route awaits the filter chain directly.
interface Result {
  data: unknown;
  error: unknown;
}
let queues: Record<string, Result[]> = {};
let tablesQueried: string[] = [];

interface Builder extends PromiseLike<Result> {
  select: (cols?: string) => Builder;
  eq: (col: string, val: unknown) => Builder;
  in: (col: string, vals: unknown[]) => Builder;
  order: (col: string, opts?: unknown) => Builder;
}

function makeBuilder(table: string): Builder {
  const resolve = (): Result =>
    queues[table]?.shift() ?? { data: null, error: null };
  const builder: Builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    then: (onF, onR) => Promise.resolve(resolve()).then(onF, onR),
  };
  return builder;
}

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      tablesQueried.push(table);
      return makeBuilder(table);
    },
  }),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

import { GET } from "./route";

beforeEach(() => {
  queues = {};
  tablesQueried = [];
  mockGetUser.mockReset();
  logErrorMock.mockClear();
});

describe("GET /api/customers/csv", () => {
  it("returns 401 without a session — the export leaks nothing to anonymous callers", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(new Request("https://shyre.test/api/customers/csv"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("streams a CSV with quoted fields and resolved team names for an authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["customers_v"] = [
      {
        data: [
          {
            id: "cust-1",
            team_id: "team-1",
            name: 'Acme, "Inc."',
            email: "billing@acme.test",
            address: null,
            notes: "Line1\nLine2",
            default_rate: 150,
            payment_terms_days: 30,
            archived: false,
            imported_from: null,
            imported_at: null,
            created_at: "2026-01-05T00:00:00+00:00",
          },
        ],
        error: null,
      },
    ];
    queues["teams"] = [
      { data: [{ id: "team-1", name: "Malcom IO" }], error: null },
    ];

    const res = await GET(new Request("https://shyre.test/api/customers/csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="shyre-customers-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.text();
    const [header] = body.split("\n");
    expect(header).toBe(
      "customer_id,team,team_id,name,email,address,notes,default_rate,payment_terms_days,archived,inactive_at,imported_from,imported_at,created_at",
    );
    // Comma + quote in the name → RFC-4180 quoting with doubled quotes.
    expect(body).toContain('"Acme, ""Inc."""');
    // Embedded newline in notes stays inside one quoted field.
    expect(body).toContain('"Line1\nLine2"');
    // Team UUID resolves to its display name.
    expect(body).toContain("Malcom IO");
    expect(body).toContain("cust-1,");
  });

  it("reads the masked customers_v view, never the base table (SAL-053)", async () => {
    // The base table carries raw default_rate for every visible row; only
    // the view applies the can_view_customer_rate() mask. Querying the
    // base table here would export every customer's billing rate to any
    // plain team member regardless of the team's rate_visibility setting.
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["customers_v"] = [{ data: [], error: null }];
    const res = await GET(new Request("https://shyre.test/api/customers/csv"));
    expect(res.status).toBe(200);
    expect(tablesQueried).toContain("customers_v");
    expect(tablesQueried).not.toContain("customers");
  });

  it("returns 500 and logs when the customers query fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["customers_v"] = [
      { data: null, error: { message: "permission denied" } },
    ];
    const res = await GET(
      new Request("https://shyre.test/api/customers/csv?org=team-1"),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Export failed");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const ctx = logErrorMock.mock.calls[0]![1] as {
      userId: string;
      teamId: string;
      action: string;
    };
    expect(ctx).toMatchObject({
      userId: "u1",
      teamId: "team-1",
      action: "exportCustomers",
    });
  });

  it("formula-leading fields are escaped in the export (SAL-048)", () => {
    // The route funnels every cell through escapeCsvField, which (since
    // SAL-048) apostrophe-prefixes leading = + - @ on string inputs.
    expect(escapeCsvField("=HYPERLINK(\"http://evil\")")).toMatch(/^"'=/);
    expect(escapeCsvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});
