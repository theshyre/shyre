import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const startTimerMock = vi.fn();
vi.mock("@/lib/integrations/service", () => ({
  startTimer: (...args: unknown[]) => startTimerMock(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { POST } from "./route";

const RAW_PAT = `shyre_pat_${"g".repeat(43)}`;
const PROJECT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function makeRequest(body: unknown, auth?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/v1/timer/start", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  logErrorMock.mockClear();
  startTimerMock.mockReset();
});

describe("POST /api/v1/timer/start", () => {
  it("returns the uniform 401 body without a bearer PAT", async () => {
    const res = await POST(makeRequest({ project_id: PROJECT_ID }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(startTimerMock).not.toHaveBeenCalled();
  });

  it("starts the timer and returns the created entry", async () => {
    const entry = { id: "e1", project_id: PROJECT_ID, started_by_kind: "agent" };
    startTimerMock.mockResolvedValue({ ok: true, data: entry });
    const res = await POST(
      makeRequest(
        {
          project_id: PROJECT_ID,
          description: "pairing on the release",
          session_ref: "sess-1",
          idempotency_key: "idem-1",
        },
        `Bearer ${RAW_PAT}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(entry);
    expect(startTimerMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT), {
      projectId: PROJECT_ID,
      description: "pairing on the release",
      agentLabel: undefined,
      sessionRef: "sess-1",
      idempotencyKey: "idem-1",
    });
  });

  it("rejects a body without project_id (Zod) before touching the service", async () => {
    const res = await POST(makeRequest({ description: "x" }, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toBe("invalid_request");
    expect(body.issues.some((i) => i.path === "project_id")).toBe(true);
    expect(startTimerMock).not.toHaveBeenCalled();
  });

  it("rejects unknown body keys (strict schema)", async () => {
    const res = await POST(
      makeRequest({ project_id: PROJECT_ID, billable: true }, `Bearer ${RAW_PAT}`),
    );
    expect(res.status).toBe(400);
    expect(startTimerMock).not.toHaveBeenCalled();
  });

  it("returns 409 with the conflict detail when a timer is already running — never displaces it", async () => {
    startTimerMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: "conflict",
      message: "timer already running",
    });
    const res = await POST(
      makeRequest({ project_id: PROJECT_ID }, `Bearer ${RAW_PAT}`),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      message: "timer already running",
    });
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("returns 404 for a project outside the token's team", async () => {
    startTimerMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: "not_found",
      message: "unknown project",
    });
    const res = await POST(
      makeRequest({ project_id: PROJECT_ID }, `Bearer ${RAW_PAT}`),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: "unknown project",
    });
  });
});
