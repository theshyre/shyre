import { describe, it, expect, vi, beforeEach } from "vitest";

// Queue-per-table thenable builder; filter calls recorded to assert
// the URL filters actually narrow the query.
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
  gte: (col: string, val: unknown) => Builder;
  lte: (col: string, val: unknown) => Builder;
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
    gte: track("gte"),
    lte: track("lte"),
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

beforeEach(() => {
  queues = {};
  filters = [];
  mockGetUser.mockReset();
  logErrorMock.mockClear();
});

describe("GET /api/business/[businessId]/people-history/csv", () => {
  it("returns 401 without a session — the audit trail is not anonymous-readable", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/people-history/csv"),
      ctx(),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("returns 500 and logs when the history query fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["business_people_history"] = [
      { data: null, error: { message: "boom" } },
    ];
    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/people-history/csv"),
      ctx(),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Export failed");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      url: "/api/business/biz-1/people-history/csv",
      action: "exportPeopleHistory",
    });
  });

  it("expands entries into one CSV row per changed field, diffing against the next-newer snapshot", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    // Newest-first, same person: the older entry's diff is computed
    // against the newer one (legal_name changed between them).
    queues["business_people_history"] = [
      {
        data: [
          {
            id: "h2",
            business_person_id: "p-1",
            operation: "UPDATE",
            changed_at: "2026-06-02T10:00:00+00:00",
            changed_by_user_id: "u1",
            previous_state: { legal_name: "Mariah M", title: "Dev" },
          },
          {
            id: "h1",
            business_person_id: "p-1",
            operation: "UPDATE",
            changed_at: "2026-06-01T10:00:00+00:00",
            changed_by_user_id: "u9",
            previous_state: { legal_name: "Mariah Malcom", title: "Dev" },
          },
        ],
        error: null,
      },
    ];
    queues["user_profiles"] = [
      {
        data: [
          { user_id: "u1", display_name: "Marcus" },
          { user_id: "u9", display_name: "Robo Admin" },
        ],
        error: null,
      },
    ];
    queues["business_people"] = [
      {
        data: [
          { id: "p-1", legal_name: "Mariah Malcom", preferred_name: "Mariah" },
        ],
        error: null,
      },
    ];

    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/people-history/csv"),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="shyre-people-history-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.text();
    const lines = body.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "changed_at,person_name,person_id,operation,actor_name,actor_user_id,field,previous_value,new_value",
    );
    // Newest entry: no newer neighbor → enumerates its labeled fields
    // (legal_name + title), new_value blank.
    expect(lines).toContain(
      "2026-06-02T10:00:00+00:00,Mariah,p-1,UPDATE,Marcus,u1,Legal name,Mariah M,",
    );
    expect(lines).toContain(
      "2026-06-02T10:00:00+00:00,Mariah,p-1,UPDATE,Marcus,u1,Title,Dev,",
    );
    // Older entry: only the field that actually changed vs. the newer
    // snapshot, with both sides filled in.
    expect(lines).toContain(
      "2026-06-01T10:00:00+00:00,Mariah,p-1,UPDATE,Robo Admin,u9,Legal name,Mariah Malcom,Mariah M",
    );
    expect(lines).toHaveLength(4);
  });

  it("labels a deleted person from their last snapshot's legal_name", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["business_people_history"] = [
      {
        data: [
          {
            id: "h1",
            business_person_id: "p-gone",
            operation: "DELETE",
            changed_at: "2026-06-03T10:00:00+00:00",
            changed_by_user_id: null,
            previous_state: { legal_name: "Departed Dev" },
          },
        ],
        error: null,
      },
    ];
    // The live business_people lookup finds nothing — row is gone.
    queues["business_people"] = [{ data: [], error: null }];

    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/people-history/csv"),
      ctx(),
    );
    const body = await res.text();
    expect(body).toContain("Departed Dev,p-gone,DELETE");
    // No actor → both actor columns empty.
    expect(body).toContain("DELETE,,,Legal name,Departed Dev,");
  });

  it("applies from/to/personId/actorUserId filters, widening a bare to-date to end-of-day", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["business_people_history"] = [{ data: [], error: null }];

    const res = await GET(
      new Request(
        "https://shyre.test/api/business/biz-1/people-history/csv?from=2026-01-01&to=2026-06-30&personId=p-1&actorUserId=u9",
      ),
      ctx(),
    );
    expect(res.status).toBe(200);
    const hist = filters.filter((f) => f.table === "business_people_history");
    expect(hist).toContainEqual({
      table: "business_people_history",
      method: "eq",
      args: ["business_id", "biz-1"],
    });
    expect(hist).toContainEqual({
      table: "business_people_history",
      method: "gte",
      args: ["changed_at", "2026-01-01"],
    });
    // Bare date widened so the whole final day is included.
    expect(hist).toContainEqual({
      table: "business_people_history",
      method: "lte",
      args: ["changed_at", "2026-06-30T23:59:59.999Z"],
    });
    expect(hist).toContainEqual({
      table: "business_people_history",
      method: "eq",
      args: ["business_person_id", "p-1"],
    });
    expect(hist).toContainEqual({
      table: "business_people_history",
      method: "eq",
      args: ["changed_by_user_id", "u9"],
    });
  });

  it("snapshot values with formula triggers arrive apostrophe-escaped (SAL-048)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    queues["business_people_history"] = [
      {
        data: [
          {
            id: "h1",
            business_person_id: "p-1",
            operation: "UPDATE",
            changed_at: "2026-06-03T10:00:00+00:00",
            changed_by_user_id: null,
            previous_state: { legal_name: "=HYPERLINK(\"http://evil\")" },
          },
        ],
        error: null,
      },
    ];
    queues["business_people"] = [{ data: [], error: null }];

    const res = await GET(
      new Request("https://shyre.test/api/business/biz-1/people-history/csv"),
      ctx(),
    );
    const body = await res.text();
    expect(body).toContain("'=HYPERLINK");
  });
});
