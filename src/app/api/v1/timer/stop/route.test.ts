import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const stopTimerMock = vi.fn();
vi.mock("@/lib/integrations/service", () => ({
  stopTimer: (...args: unknown[]) => stopTimerMock(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { POST } from "./route";

const RAW_PAT = `shyre_pat_${"h".repeat(43)}`;

function makeRequest(body: unknown, auth?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/v1/timer/stop", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  logErrorMock.mockClear();
  stopTimerMock.mockReset();
});

describe("POST /api/v1/timer/stop", () => {
  it("returns the uniform 401 body without a bearer PAT", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(stopTimerMock).not.toHaveBeenCalled();
  });

  it("stops the timer with an outcome description", async () => {
    const stopped = { id: "e1", end_time: "2026-07-18T15:00:00+00:00" };
    stopTimerMock.mockResolvedValue({ ok: true, data: stopped });
    const res = await POST(
      makeRequest({ description: "shipped the docs page" }, `Bearer ${RAW_PAT}`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(stopped);
    expect(stopTimerMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT), {
      description: "shipped the docs page",
      force: undefined,
    });
  });

  it("forwards force: true for an explicit human-timer stop", async () => {
    stopTimerMock.mockResolvedValue({ ok: true, data: { id: "e1" } });
    await POST(makeRequest({ force: true }, `Bearer ${RAW_PAT}`));
    expect(stopTimerMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT), {
      description: undefined,
      force: true,
    });
  });

  it("rejects a non-boolean force value (Zod)", async () => {
    const res = await POST(makeRequest({ force: "yes" }, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(400);
    expect(stopTimerMock).not.toHaveBeenCalled();
  });

  it("rejects unknown body keys (strict schema)", async () => {
    const res = await POST(
      makeRequest({ end_time: "2026-07-18T15:00:00Z" }, `Bearer ${RAW_PAT}`),
    );
    expect(res.status).toBe(400);
    expect(stopTimerMock).not.toHaveBeenCalled();
  });

  it("returns 409 with detail when the running timer is human-started and force is absent", async () => {
    stopTimerMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: "conflict",
      message: "running timer was not started by an agent",
    });
    const res = await POST(makeRequest({}, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      message: "running timer was not started by an agent",
    });
  });

  it("returns 404 when no timer is running", async () => {
    stopTimerMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: "not_found",
      message: "no running timer",
    });
    const res = await POST(makeRequest({}, `Bearer ${RAW_PAT}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(logErrorMock).toHaveBeenCalled();
  });
});
