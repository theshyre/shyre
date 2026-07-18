import { describe, it, expect, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const whoamiMock = vi.fn();
vi.mock("./service", () => ({
  whoami: (...args: unknown[]) => whoamiMock(...args),
}));

import {
  toToolResult,
  tokenHashFromAuthInfo,
  verifyIntegrationBearer,
} from "./mcp-auth";
import { sha256Hex } from "./tokens";

const RAW_PAT = `shyre_pat_${"c".repeat(43)}`;
const HASH = sha256Hex(RAW_PAT);

function makeRequest(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/mcp", { method: "POST", headers });
}

beforeEach(() => {
  logErrorMock.mockClear();
  whoamiMock.mockReset();
});

describe("verifyIntegrationBearer", () => {
  it("returns undefined (→ 401) when no bearer token is provided, and logs", async () => {
    const result = await verifyIntegrationBearer(makeRequest());
    expect(result).toBeUndefined();
    expect(whoamiMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for a malformed token without touching the database", async () => {
    const result = await verifyIntegrationBearer(makeRequest(), "not-a-shyre-token");
    expect(result).toBeUndefined();
    expect(whoamiMock).not.toHaveBeenCalled();
  });

  it("returns undefined when api_whoami refuses the token (revoked/expired/kill switch — same shape)", async () => {
    whoamiMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "invalid token",
    });
    const result = await verifyIntegrationBearer(makeRequest(), RAW_PAT);
    expect(result).toBeUndefined();
    expect(whoamiMock).toHaveBeenCalledWith(HASH);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("returns AuthInfo carrying the token HASH — never the raw PAT — on success", async () => {
    whoamiMock.mockResolvedValue({
      ok: true,
      data: {
        user_id: "user-1",
        scopes: ["context:read", "timer:read"],
        team_id: "team-1",
      },
    });
    const info = await verifyIntegrationBearer(makeRequest(), RAW_PAT);
    expect(info).toBeDefined();
    expect(info?.token).toBe(HASH);
    expect(info?.clientId).toBe("user-1");
    expect(info?.scopes).toEqual(["context:read", "timer:read"]);
    expect(info?.extra?.tokenHash).toBe(HASH);
    expect(JSON.stringify(info)).not.toContain(RAW_PAT);
  });

  it("falls back to the Authorization header when mcp-handler passes no pre-extracted token", async () => {
    whoamiMock.mockResolvedValue({ ok: true, data: { user_id: "user-1", scopes: [] } });
    const info = await verifyIntegrationBearer(makeRequest(`Bearer ${RAW_PAT}`));
    expect(info?.extra?.tokenHash).toBe(HASH);
  });

  it("never logs the raw PAT on failure paths", async () => {
    whoamiMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
      message: `bad token ${RAW_PAT}`,
    });
    await verifyIntegrationBearer(makeRequest(), RAW_PAT);
    const logged = JSON.stringify(
      logErrorMock.mock.calls.map((call) =>
        call.map((arg) =>
          arg instanceof Error
            ? { message: arg.message, ...(arg as unknown as Record<string, unknown>) }
            : arg,
        ),
      ),
    );
    expect(logged).not.toContain(RAW_PAT);
  });
});

describe("tokenHashFromAuthInfo", () => {
  it("round-trips the hash stored by verifyIntegrationBearer", async () => {
    whoamiMock.mockResolvedValue({ ok: true, data: { user_id: "u", scopes: [] } });
    const info = await verifyIntegrationBearer(makeRequest(), RAW_PAT);
    expect(tokenHashFromAuthInfo(info)).toBe(HASH);
  });

  it("returns null for missing or malformed authInfo", () => {
    expect(tokenHashFromAuthInfo(undefined)).toBeNull();
    expect(
      tokenHashFromAuthInfo({ token: "t", clientId: "c", scopes: [] }),
    ).toBeNull();
    expect(
      tokenHashFromAuthInfo({
        token: "t",
        clientId: "c",
        scopes: [],
        extra: { tokenHash: "" },
      }),
    ).toBeNull();
  });
});

describe("toToolResult", () => {
  it("serializes successful data as text content", () => {
    const result = toToolResult(
      { ok: true, data: { id: "e1" } },
      { action: "api.mcp.test" },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe("text");
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({ id: "e1" });
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("marks failures isError, logs them, and forwards the conflict detail", () => {
    const result = toToolResult(
      { ok: false, status: 409, error: "conflict", message: "timer already running" },
      { action: "api.mcp.start_timer" },
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      error: "conflict",
      message: "timer already running",
    });
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("keeps unauthorized uniform — no reason leaks into the tool result", () => {
    const result = toToolResult(
      {
        ok: false,
        status: 401,
        error: "unauthorized",
        message: "token expired 2026-07-01",
      },
      { action: "api.mcp.test" },
    );
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      error: "unauthorized",
      message: "unauthorized",
    });
  });

  it("redacts PATs from failure messages", () => {
    const result = toToolResult(
      {
        ok: false,
        status: 500,
        error: "internal",
        message: `broke on ${RAW_PAT}`,
      },
      { action: "api.mcp.test" },
    );
    expect(result.content[0]?.text).not.toContain(RAW_PAT);
    expect(result.content[0]?.text).toContain("shyre_pat_[REDACTED]");
  });
});
