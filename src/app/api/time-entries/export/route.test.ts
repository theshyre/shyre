import { describe, it, expect, vi, beforeEach } from "vitest";

// Queue-per-table thenable builder. Filter calls are recorded so the
// team/billable narrowing can be asserted as behavior.
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
  lt: (col: string, val: unknown) => Builder;
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
    lt: track("lt"),
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

function entryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "te-1",
    user_id: "u2",
    team_id: "team-1",
    project_id: "proj-1",
    invoice_id: null,
    start_time: "2026-01-05T09:00:00+00:00",
    end_time: "2026-01-05T11:30:00+00:00",
    duration_min: 150,
    description: "Pairing on the importer",
    billable: true,
    github_issue: null,
    linked_ticket_provider: null,
    linked_ticket_key: null,
    category_id: "cat-1",
    projects: {
      name: "Website",
      customer_id: "cust-1",
      budget_period: "monthly",
      budget_hours_per_period: 40,
      budget_dollars_per_period: null,
      customers: { name: "Acme" },
    },
    categories: { name: "Dev", category_sets: { name: "Harvest Tasks" } },
    ...overrides,
  };
}

beforeEach(() => {
  queues = {};
  filters = [];
  mockGetUser.mockReset();
  logErrorMock.mockClear();
});

describe("GET /api/time-entries/export", () => {
  it("returns 401 without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(
      new Request("https://shyre.test/api/time-entries/export"),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("exports the week as CSV with resolved names, authorship, and ticket folding", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["time_entries"] = [
      {
        data: [
          entryRow(),
          // Second entry: unified linked_ticket columns → legacy
          // githubIssue column derives the numeric id.
          entryRow({
            id: "te-2",
            user_id: "u3",
            linked_ticket_provider: "github",
            linked_ticket_key: "octokit/rest.js#123",
            invoice_id: "inv-9",
          }),
        ],
        error: null,
      },
    ];
    queues["user_profiles"] = [
      {
        data: [
          { user_id: "u2", display_name: "Mariah" },
          { user_id: "u3", display_name: "Marcus" },
        ],
        error: null,
      },
    ];

    const res = await GET(
      new Request(
        "https://shyre.test/api/time-entries/export?anchor=2026-01-05",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="shyre-time-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.text();
    const lines = body.trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    const row1 = lines[1] ?? "";
    const row2 = lines[2] ?? "";
    // Row content: names resolved, category chain, authorship.
    expect(row1).toContain("2026-01-05,09:00,11:30,150");
    expect(row1).toContain("Website");
    expect(row1).toContain("Acme");
    expect(row1).toContain("Dev");
    expect(row1).toContain("Harvest Tasks");
    expect(row1).toContain("Mariah");
    // Ticket folding: owner/repo#123 → legacy githubIssue column 123,
    // and the invoiced flag reflects invoice_id.
    expect(row2).toContain("octokit/rest.js#123");
    expect(row2).toContain(",123,");
    expect(row2).toContain("inv-9");
    expect(row2).toContain("Marcus");
  });

  it("narrows by team and billable when the page's filters are in the URL", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["time_entries"] = [{ data: [], error: null }];

    const res = await GET(
      new Request(
        "https://shyre.test/api/time-entries/export?team=team-1&billable=1&view=day&anchor=2026-01-05",
      ),
    );
    expect(res.status).toBe(200);
    const te = filters.filter((f) => f.table === "time_entries");
    expect(te).toContainEqual({
      table: "time_entries",
      method: "eq",
      args: ["team_id", "team-1"],
    });
    expect(te).toContainEqual({
      table: "time_entries",
      method: "eq",
      args: ["billable", true],
    });
    // Soft-deleted entries are excluded.
    expect(te).toContainEqual({
      table: "time_entries",
      method: "is",
      args: ["deleted_at", null],
    });
    // Day view = a 24h window (one gte + one lt on start_time).
    const gte = te.find((f) => f.method === "gte");
    const lt = te.find((f) => f.method === "lt");
    expect(gte?.args[0]).toBe("start_time");
    expect(lt?.args[0]).toBe("start_time");
    const start = new Date(String(gte?.args[1]));
    const end = new Date(String(lt?.args[1]));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("returns 500 and logs when the entries query fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["time_entries"] = [{ data: null, error: { message: "boom" } }];
    const res = await GET(
      new Request("https://shyre.test/api/time-entries/export?team=team-1"),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Export failed");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      teamId: "team-1",
      url: "/api/time-entries/export",
      action: "exportTimeEntries",
    });
  });

  it("degrades to blank author names (still 200, logged) when the profiles lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["time_entries"] = [{ data: [entryRow()], error: null }];
    queues["user_profiles"] = [
      { data: null, error: { message: "profiles down" } },
    ];
    const res = await GET(
      new Request("https://shyre.test/api/time-entries/export"),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("te-1");
    expect(body).not.toContain("Mariah");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![1]).toMatchObject({
      action: "exportTimeEntries.profiles",
    });
  });

  it("description cells with formula triggers arrive apostrophe-escaped (SAL-048)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["time_entries"] = [
      { data: [entryRow({ description: "=cmd|' /C calc'!A0" })], error: null },
    ];
    queues["user_profiles"] = [
      { data: [{ user_id: "u2", display_name: "Mariah" }], error: null },
    ];
    const res = await GET(
      new Request("https://shyre.test/api/time-entries/export"),
    );
    const body = await res.text();
    expect(body).toContain("'=cmd|");
  });

  it("emits a Source column separating agent hours from user hours (SAL-051)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["time_entries"] = [
      {
        data: [
          entryRow(), // no started_by_kind selected → defaults to "user"
          entryRow({
            id: "te-agent",
            started_by_kind: "agent",
            agent_label: "Claude Code",
          }),
          entryRow({ id: "te-import", started_by_kind: "import" }),
        ],
        error: null,
      },
    ];
    queues["user_profiles"] = [
      { data: [{ user_id: "u2", display_name: "Mariah" }], error: null },
    ];
    const res = await GET(
      new Request("https://shyre.test/api/time-entries/export"),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    const lines = body.trimEnd().split("\r\n");
    expect((lines[0] ?? "").endsWith(",Source")).toBe(true);
    expect(lines[1]).toMatch(/,user$/);
    expect(lines[2]).toMatch(/,agent \(Claude Code\)$/);
    expect(lines[3]).toMatch(/,import$/);
    // The route's select must actually request the columns —
    // otherwise every row would silently degrade to "user".
    const selectCall = filters.find(
      (f) => f.table === "time_entries" && f.method === "select",
    );
    expect(String(selectCall?.args[0])).toContain("started_by_kind");
    expect(String(selectCall?.args[0])).toContain("agent_label");
  });

  it("neutralizes a formula-injection agent label in the Source column (SAL-048 defense holds)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["time_entries"] = [
      {
        data: [
          entryRow({
            started_by_kind: "agent",
            agent_label: '=HYPERLINK("http://evil")',
          }),
        ],
        error: null,
      },
    ];
    queues["user_profiles"] = [
      { data: [{ user_id: "u2", display_name: "Mariah" }], error: null },
    ];
    const res = await GET(
      new Request("https://shyre.test/api/time-entries/export"),
    );
    const body = await res.text();
    // The kind prefix means the field never starts with "=", and the
    // embedded quotes/commas are RFC-4180 escaped by escapeCsvField.
    expect(body).toContain('"agent (=HYPERLINK(""http://evil""))"');
    expect(body).not.toMatch(/,=HYPERLINK/);
  });
});
