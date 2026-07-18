// @vitest-environment node
// mcp-handler's response adapter type-checks chunks with `instanceof
// Uint8Array`; under jsdom the SDK's chunks come from the node realm and
// fail that check ("Unexpected chunk type"), so this file runs in the
// node environment.
import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const serviceMocks = {
  whoami: vi.fn(),
  listProjects: vi.fn(),
  getTimer: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  logEntry: vi.fn(),
};
vi.mock("@/lib/integrations/service", () => ({
  whoami: (...args: unknown[]) => serviceMocks.whoami(...args),
  listProjects: (...args: unknown[]) => serviceMocks.listProjects(...args),
  getTimer: (...args: unknown[]) => serviceMocks.getTimer(...args),
  startTimer: (...args: unknown[]) => serviceMocks.startTimer(...args),
  stopTimer: (...args: unknown[]) => serviceMocks.stopTimer(...args),
  logEntry: (...args: unknown[]) => serviceMocks.logEntry(...args),
}));

import { sha256Hex } from "@/lib/integrations/tokens";

import { GET, POST, DELETE, runtime, maxDuration } from "./route";

const RAW_PAT = `shyre_pat_${"j".repeat(43)}`;

function initializeRequest(auth?: string): Request {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0.0.0" },
      },
    }),
  });
}

beforeEach(() => {
  logErrorMock.mockClear();
  for (const mock of Object.values(serviceMocks)) mock.mockReset();
});

describe("/api/mcp", () => {
  it("exports handlers for the streamable-HTTP verbs and Node runtime config", () => {
    expect(typeof GET).toBe("function");
    expect(typeof POST).toBe("function");
    expect(typeof DELETE).toBe("function");
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("rejects a request without an Authorization header with 401 before any tool runs", async () => {
    const res = await POST(initializeRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(serviceMocks.whoami).not.toHaveBeenCalled();
  });

  it("rejects a malformed bearer token with the same 401 — and never queries the database", async () => {
    const res = await POST(initializeRequest("Bearer not-a-shyre-token"));
    expect(res.status).toBe(401);
    expect(serviceMocks.whoami).not.toHaveBeenCalled();
  });

  it("rejects a revoked/expired/unknown PAT with the same 401 shape (no oracle) and logs the attempt", async () => {
    serviceMocks.whoami.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "invalid token",
    });
    const res = await POST(initializeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(401);
    expect(serviceMocks.whoami).toHaveBeenCalledWith(sha256Hex(RAW_PAT));
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("accepts a valid PAT: the initialize handshake passes auth and reaches the MCP server", async () => {
    serviceMocks.whoami.mockResolvedValue({
      ok: true,
      data: {
        user_id: "user-1",
        scopes: ["context:read", "timer:read", "timer:write", "entries:write"],
      },
    });
    const res = await POST(initializeRequest(`Bearer ${RAW_PAT}`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"serverInfo"');
    expect(text).toContain('"shyre"');
    // The raw PAT must never appear in any response payload.
    expect(text).not.toContain(RAW_PAT);
  }, 15000);
});
