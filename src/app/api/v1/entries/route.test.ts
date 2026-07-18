import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const logEntryMock = vi.fn();
vi.mock("@/lib/integrations/service", () => ({
  logEntry: (...args: unknown[]) => logEntryMock(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { POST } from "./route";

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

  it("returns 400 when the RPC refuses the time range (TK400)", async () => {
    logEntryMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: "invalid_request",
      message: "invalid time range",
    });
    const res = await POST(makeRequest(VALID_BODY, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });
});
