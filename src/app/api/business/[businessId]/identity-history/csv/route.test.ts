import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IdentityHistoryEntry } from "@/app/(dashboard)/business/identity-history-types";

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
  }),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const historyActionMock = vi.fn();
vi.mock("@/app/(dashboard)/business/actions", () => ({
  getBusinessIdentityHistoryAction: (businessId: string, opts: unknown) =>
    historyActionMock(businessId, opts),
}));

import { GET } from "./route";

function ctx(businessId = "biz-1"): { params: Promise<{ businessId: string }> } {
  return { params: Promise.resolve({ businessId }) };
}

function entry(overrides: Partial<IdentityHistoryEntry>): IdentityHistoryEntry {
  return {
    id: "h1",
    kind: "business",
    registrationId: "",
    rowLabel: "Malcom IO LLC",
    operation: "UPDATE",
    changedAt: "2026-06-02T10:00:00+00:00",
    changedBy: { userId: "u1", displayName: "Marcus", email: null },
    previousState: {},
    ...overrides,
  };
}

beforeEach(() => {
  mockGetUser.mockReset();
  logErrorMock.mockClear();
  historyActionMock.mockReset();
});

describe("GET /api/business/[businessId]/identity-history/csv", () => {
  it("returns 401 without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(
      new Request(
        "https://shyre.test/api/business/biz-1/identity-history/csv",
      ),
      ctx(),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expect(historyActionMock).not.toHaveBeenCalled();
  });

  it("pages through the action until hasMore=false and emits one row per changed field", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    // Two pages; the second page's entry is an older snapshot of the
    // same business row, so its diff is computed against page one's.
    historyActionMock
      .mockResolvedValueOnce({
        history: [
          entry({
            id: "h2",
            previousState: { legal_name: "Malcom IO LLC", tax_id: "99-1" },
          }),
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        history: [
          entry({
            id: "h1",
            changedAt: "2026-06-01T10:00:00+00:00",
            changedBy: { userId: "u9", displayName: "Robo", email: null },
            previousState: { legal_name: "Malcom Inc", tax_id: "99-1" },
          }),
        ],
        hasMore: false,
      });

    const res = await GET(
      new Request(
        "https://shyre.test/api/business/biz-1/identity-history/csv",
      ),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="shyre-identity-history-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    // Pagination contract: second call advanced the offset by the
    // first page's length, then stopped on hasMore=false.
    expect(historyActionMock).toHaveBeenCalledTimes(2);
    expect(historyActionMock.mock.calls[0]).toEqual([
      "biz-1",
      { limit: 500, offset: 0 },
    ]);
    expect(historyActionMock.mock.calls[1]).toEqual([
      "biz-1",
      { limit: 500, offset: 1 },
    ]);

    const body = await res.text();
    const lines = body.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "changed_at,kind,row_label,operation,actor_name,actor_user_id,field,previous_value,new_value",
    );
    // Newest entry enumerates its labeled fields.
    expect(lines).toContain(
      "2026-06-02T10:00:00+00:00,business,Malcom IO LLC,UPDATE,Marcus,u1,Legal name,Malcom IO LLC,",
    );
    expect(lines).toContain(
      "2026-06-02T10:00:00+00:00,business,Malcom IO LLC,UPDATE,Marcus,u1,Tax ID (EIN),99-1,",
    );
    // Older entry: only the changed field, with the diff filled in.
    expect(lines).toContain(
      "2026-06-01T10:00:00+00:00,business,Malcom IO LLC,UPDATE,Robo,u9,Legal name,Malcom Inc,Malcom IO LLC",
    );
    expect(lines).toHaveLength(4);
  });

  it("registration entries use the registration label map", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    historyActionMock.mockResolvedValue({
      history: [
        entry({
          kind: "registration",
          registrationId: "reg-1",
          rowLabel: "California",
          previousState: { entity_number: "C1234567" },
        }),
      ],
      hasMore: false,
    });
    const res = await GET(
      new Request(
        "https://shyre.test/api/business/biz-1/identity-history/csv",
      ),
      ctx(),
    );
    const body = await res.text();
    expect(body).toContain(
      "registration,California,UPDATE,Marcus,u1,Entity number,C1234567,",
    );
  });

  it("returns 500 and logs when the underlying action throws (e.g. no access)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    historyActionMock.mockRejectedValue(new Error("no access"));
    const res = await GET(
      new Request(
        "https://shyre.test/api/business/biz-1/identity-history/csv",
      ),
      ctx(),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Export failed");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      url: "/api/business/biz-1/identity-history/csv",
      action: "exportIdentityHistory",
    });
  });

  it("snapshot values with formula triggers arrive apostrophe-escaped (SAL-048)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    historyActionMock.mockResolvedValue({
      history: [
        entry({ previousState: { legal_name: "=HYPERLINK(\"http://evil\")" } }),
      ],
      hasMore: false,
    });
    const res = await GET(
      new Request(
        "https://shyre.test/api/business/biz-1/identity-history/csv",
      ),
      ctx(),
    );
    const body = await res.text();
    expect(body).toContain("'=HYPERLINK");
  });
});
