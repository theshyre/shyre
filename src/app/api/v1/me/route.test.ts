import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const whoamiMock = vi.fn();
vi.mock("@/lib/integrations/service", () => ({
  whoami: (...args: unknown[]) => whoamiMock(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { GET } from "./route";

const RAW_PAT = `shyre_pat_${"d".repeat(43)}`;

function makeRequest(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/v1/me", { headers });
}

beforeEach(() => {
  logErrorMock.mockClear();
  whoamiMock.mockReset();
});

describe("GET /api/v1/me", () => {
  it("returns the uniform 401 body without a bearer PAT", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(whoamiMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("returns the whoami payload for a valid PAT, keyed by its hash", async () => {
    whoamiMock.mockResolvedValue({
      ok: true,
      data: { user_id: "u1", team_name: "Malcom LLC", scopes: ["context:read"] },
    });
    const res = await GET(makeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user_id: "u1",
      team_name: "Malcom LLC",
      scopes: ["context:read"],
    });
    expect(whoamiMock).toHaveBeenCalledWith(sha256Hex(RAW_PAT));
  });

  it("maps a refused token to the same uniform 401 as a missing one — no oracle", async () => {
    whoamiMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "invalid token",
    });
    const res = await GET(makeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("maps a rate-limited token to 429", async () => {
    whoamiMock.mockResolvedValue({
      ok: false,
      status: 429,
      error: "rate_limited",
      message: "rate limit exceeded",
    });
    const res = await GET(makeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "rate_limited",
      message: "rate limit exceeded",
    });
  });
});
