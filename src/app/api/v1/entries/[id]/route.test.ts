import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const getEntryMock = vi.fn();
const updateEntryMock = vi.fn();
const deleteEntryMock = vi.fn();
vi.mock("@/lib/integrations/service", () => ({
  getEntry: (...args: unknown[]) => getEntryMock(...args),
  updateEntry: (...args: unknown[]) => updateEntryMock(...args),
  deleteEntry: (...args: unknown[]) => deleteEntryMock(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { GET, PATCH, DELETE } from "./route";

const RAW_PAT = `shyre_pat_${"i".repeat(43)}`;
const ENTRY_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function req(method: string, body?: unknown, auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new Request(`https://shyre.test/api/v1/entries/${ENTRY_ID}`, init);
}

const params = (id: string): { params: Promise<{ id: string }> } => ({
  params: Promise.resolve({ id }),
});

beforeEach(() => {
  logErrorMock.mockClear();
  getEntryMock.mockReset();
  updateEntryMock.mockReset();
  deleteEntryMock.mockReset();
});

describe("GET /api/v1/entries/:id", () => {
  it("returns the entry and passes the id to the service", async () => {
    getEntryMock.mockResolvedValue({ ok: true, data: { id: ENTRY_ID } });
    const res = await GET(req("GET", undefined, `Bearer ${RAW_PAT}`), params(ENTRY_ID));
    expect(res.status).toBe(200);
    expect(getEntryMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT), ENTRY_ID);
  });

  it("rejects a non-uuid id with 400 before touching the service", async () => {
    const res = await GET(req("GET", undefined, `Bearer ${RAW_PAT}`), params("42"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(getEntryMock).not.toHaveBeenCalled();
  });

  it("401s without a bearer token", async () => {
    const res = await GET(req("GET"), params(ENTRY_ID));
    expect(res.status).toBe(401);
    expect(getEntryMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/entries/:id", () => {
  it("forwards the partial patch fields to the service", async () => {
    updateEntryMock.mockResolvedValue({ ok: true, data: { id: ENTRY_ID } });
    const res = await PATCH(
      req("PATCH", { end_time: "2026-07-23T15:00:00Z", category_id: ENTRY_ID }, `Bearer ${RAW_PAT}`),
      params(ENTRY_ID),
    );
    expect(res.status).toBe(200);
    expect(updateEntryMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT), ENTRY_ID, {
      startTime: undefined,
      endTime: "2026-07-23T15:00:00Z",
      description: undefined,
      categoryId: ENTRY_ID,
      billable: undefined,
    });
  });

  it("rejects unknown body keys (strict schema)", async () => {
    const res = await PATCH(
      req("PATCH", { project_id: ENTRY_ID }, `Bearer ${RAW_PAT}`),
      params(ENTRY_ID),
    );
    expect(res.status).toBe(400);
    expect(updateEntryMock).not.toHaveBeenCalled();
  });

  it("forwards the RPC's 403 for a human-entered entry with its message", async () => {
    updateEntryMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: "forbidden",
      message: "only agent-created entries can be modified via the API",
    });
    const res = await PATCH(
      req("PATCH", { billable: false }, `Bearer ${RAW_PAT}`),
      params(ENTRY_ID),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "forbidden",
      message: "only agent-created entries can be modified via the API",
    });
  });
});

describe("DELETE /api/v1/entries/:id", () => {
  it("soft-deletes via the service and returns its result", async () => {
    deleteEntryMock.mockResolvedValue({ ok: true, data: { id: ENTRY_ID, deleted: true } });
    const res = await DELETE(req("DELETE", undefined, `Bearer ${RAW_PAT}`), params(ENTRY_ID));
    expect(res.status).toBe(200);
    expect(deleteEntryMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT), ENTRY_ID);
  });

  it("forwards a 409 for an invoiced entry", async () => {
    deleteEntryMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: "conflict",
      message: "entry is invoiced; void the invoice first",
    });
    const res = await DELETE(req("DELETE", undefined, `Bearer ${RAW_PAT}`), params(ENTRY_ID));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      message: "entry is invoiced; void the invoice first",
    });
  });

  it("rejects a non-uuid id with 400", async () => {
    const res = await DELETE(req("DELETE", undefined, `Bearer ${RAW_PAT}`), params("nope"));
    expect(res.status).toBe(400);
    expect(deleteEntryMock).not.toHaveBeenCalled();
  });
});
