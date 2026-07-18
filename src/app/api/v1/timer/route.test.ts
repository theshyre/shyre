import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const getTimerMock = vi.fn();
vi.mock("@/lib/integrations/service", () => ({
  getTimer: (...args: unknown[]) => getTimerMock(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { GET } from "./route";

const RAW_PAT = `shyre_pat_${"f".repeat(43)}`;

function makeRequest(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/v1/timer", { headers });
}

beforeEach(() => {
  logErrorMock.mockClear();
  getTimerMock.mockReset();
});

describe("GET /api/v1/timer", () => {
  it("returns the uniform 401 body without a bearer PAT", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(getTimerMock).not.toHaveBeenCalled();
  });

  it("returns the running entry for a valid PAT", async () => {
    const running = {
      id: "e1",
      project_id: "p1",
      project_name: "Atlas",
      start_time: "2026-07-18T14:00:00+00:00",
      started_by_kind: "agent",
    };
    getTimerMock.mockResolvedValue({ ok: true, data: running });
    const res = await GET(makeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(running);
    expect(getTimerMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT));
  });

  it("returns a JSON null body when no timer is running (still 200)", async () => {
    getTimerMock.mockResolvedValue({ ok: true, data: null });
    const res = await GET(makeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("maps a revoked token to the uniform 401", async () => {
    getTimerMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "invalid token",
    });
    const res = await GET(makeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
