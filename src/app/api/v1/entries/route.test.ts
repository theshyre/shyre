import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const logEntryMock = vi.fn();
const listEntriesMock = vi.fn();
vi.mock("@/lib/integrations/service", () => ({
  logEntry: (...args: unknown[]) => logEntryMock(...args),
  listEntries: (...args: unknown[]) => listEntriesMock(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { POST, GET } from "./route";

const RAW_PAT = `shyre_pat_${"i".repeat(43)}`;
const PROJECT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const VALID_BODY = {
  project_id: PROJECT_ID,
  start_time: "2026-07-18T14:00:00Z",
  end_time: "2026-07-18T15:30:00Z",
  description: "implemented the integrations REST surface",
};

function makeRequest(body: unknown, auth?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/v1/entries", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  logErrorMock.mockClear();
  logEntryMock.mockReset();
  listEntriesMock.mockReset();
});

function getRequest(query: string, auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request(`https://shyre.test/api/v1/entries${query}`, {
    method: "GET",
    headers,
  });
}

describe("GET /api/v1/entries (list)", () => {
  it("forwards parsed query filters to the service", async () => {
    listEntriesMock.mockResolvedValue({ ok: true, data: [] });
    const res = await GET(
      getRequest(`?project_id=${PROJECT_ID}&limit=50`, `Bearer ${RAW_PAT}`),
    );
    expect(res.status).toBe(200);
    expect(listEntriesMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT), {
      projectId: PROJECT_ID,
      limit: 50,
      since: undefined,
    });
  });

  it("rejects a bad limit before touching the service (400)", async () => {
    const res = await GET(getRequest("?limit=999", `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(listEntriesMock).not.toHaveBeenCalled();
  });

  it("401s without a bearer token", async () => {
    const res = await GET(getRequest("?limit=5"));
    expect(res.status).toBe(401);
    expect(listEntriesMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/entries", () => {
  it("returns the uniform 401 body without a bearer PAT", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(logEntryMock).not.toHaveBeenCalled();
  });

  it("logs a completed entry and returns it", async () => {
    const entry = { id: "e9", ...VALID_BODY, started_by_kind: "agent" };
    logEntryMock.mockResolvedValue({ ok: true, data: entry });
    const res = await POST(
      makeRequest(
        { ...VALID_BODY, session_ref: "sess-2", billable: false },
        `Bearer ${RAW_PAT}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(entry);
    expect(logEntryMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT), {
      projectId: PROJECT_ID,
      startTime: "2026-07-18T14:00:00Z",
      endTime: "2026-07-18T15:30:00Z",
      description: "implemented the integrations REST surface",
      agentLabel: undefined,
      sessionRef: "sess-2",
      idempotencyKey: undefined,
      billable: false,
    });
  });

  it("accepts offset timestamps, not just Z", async () => {
    logEntryMock.mockResolvedValue({ ok: true, data: { id: "e1" } });
    const res = await POST(
      makeRequest(
        {
          ...VALID_BODY,
          start_time: "2026-07-18T09:00:00-05:00",
          end_time: "2026-07-18T10:00:00-05:00",
        },
        `Bearer ${RAW_PAT}`,
      ),
    );
    expect(res.status).toBe(200);
  });

  it("accepts and normalizes the bare no-colon offset (the `date +%z` form that was 400ing)", async () => {
    logEntryMock.mockResolvedValue({ ok: true, data: { id: "e2" } });
    const res = await POST(
      makeRequest(
        {
          ...VALID_BODY,
          start_time: "2026-07-18T09:00:00-0500",
          end_time: "2026-07-18T10:00:00-0500",
        },
        `Bearer ${RAW_PAT}`,
      ),
    );
    expect(res.status).toBe(200);
    // The service receives the canonical colon form, not the raw -0500.
    expect(logEntryMock).toHaveBeenCalledWith(
      sha256Hex(RAW_PAT),
      expect.objectContaining({
        startTime: "2026-07-18T09:00:00-05:00",
        endTime: "2026-07-18T10:00:00-05:00",
      }),
    );
  });

  it.each([
    ["missing description", { ...VALID_BODY, description: undefined }],
    ["naive timestamp without timezone", { ...VALID_BODY, start_time: "2026-07-18T14:00:00" }],
    ["non-ISO start_time", { ...VALID_BODY, start_time: "yesterday" }],
    ["bad project uuid", { ...VALID_BODY, project_id: "42" }],
    ["unknown key", { ...VALID_BODY, user_id: "someone-else" }],
  ])("rejects %s with 400 before touching the service", async (_label, body) => {
    const res = await POST(makeRequest(body, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(logEntryMock).not.toHaveBeenCalled();
  });

  it("returns 409 with the overlap detail when the range collides with existing entries", async () => {
    logEntryMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: "conflict",
      message: "overlaps existing entries",
    });
    const res = await POST(makeRequest(VALID_BODY, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      message: "overlaps existing entries",
    });
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("returns 400 with the named rule when the RPC refuses the time range (TK400)", async () => {
    logEntryMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: "invalid_request",
      message:
        "entry exceeds the 24-hour per-entry maximum; split the work into smaller entries",
    });
    const res = await POST(makeRequest(VALID_BODY, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(400);
    // The refusal names its rule — a bare { error: "invalid_request" }
    // once made a policy refusal look like a malformed request (the
    // 22-entry backfill incident).
    expect(await res.json()).toEqual({
      error: "invalid_request",
      message:
        "entry exceeds the 24-hour per-entry maximum; split the work into smaller entries",
    });
  });

  it("returns 403 with the lock detail when the entry is dated in a locked period (TK403)", async () => {
    logEntryMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: "forbidden",
      message:
        "period locked: the books are closed through 2026-06-30; entries on or before that date are refused",
    });
    const res = await POST(makeRequest(VALID_BODY, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "forbidden",
      message:
        "period locked: the books are closed through 2026-06-30; entries on or before that date are refused",
    });
    expect(logErrorMock).toHaveBeenCalled();
  });
});
