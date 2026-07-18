import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const listProjectsMock = vi.fn();
vi.mock("@/lib/integrations/service", () => ({
  listProjects: (...args: unknown[]) => listProjectsMock(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { GET } from "./route";

const RAW_PAT = `shyre_pat_${"e".repeat(43)}`;

function makeRequest(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/v1/projects", { headers });
}

beforeEach(() => {
  logErrorMock.mockClear();
  listProjectsMock.mockReset();
});

describe("GET /api/v1/projects", () => {
  it("returns the uniform 401 body without a bearer PAT", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  it("returns the project list for a valid PAT", async () => {
    const projects = [
      { id: "p1", name: "Atlas", status: "active", customer_name: "Atlas Corp" },
    ];
    listProjectsMock.mockResolvedValue({ ok: true, data: projects });
    const res = await GET(makeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(projects);
    expect(listProjectsMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT));
  });

  it("maps a missing context:read scope to 403", async () => {
    listProjectsMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: "forbidden",
      message: "missing scope context:read",
    });
    const res = await GET(makeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(logErrorMock).toHaveBeenCalled();
  });
});
