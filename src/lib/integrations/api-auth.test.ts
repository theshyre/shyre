import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

import { runIntegrationRoute } from "./api-auth";
import type { ServiceResult } from "./service";
import { sha256Hex } from "./tokens";

const RAW_PAT = `shyre_pat_${"a".repeat(43)}`;
const HASH = sha256Hex(RAW_PAT);

function makeRequest(opts: {
  auth?: string | null;
  body?: unknown;
  rawBody?: string;
  method?: string;
} = {}): Request {
  const headers = new Headers();
  if (opts.auth !== null && opts.auth !== undefined) {
    headers.set("authorization", opts.auth);
  }
  const init: RequestInit = { method: opts.method ?? "POST", headers };
  if (opts.rawBody !== undefined) {
    init.body = opts.rawBody;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  return new Request("https://shyre.test/api/v1/thing", init);
}

/** Everything logError ever received, flattened to one string. */
function allLoggedText(): string {
  return JSON.stringify(
    logErrorMock.mock.calls.map((call) =>
      call.map((arg) =>
        arg instanceof Error
          ? { message: arg.message, ...(arg instanceof Object ? { ...arg } : {}) }
          : arg,
      ),
    ),
  );
}

beforeEach(() => {
  logErrorMock.mockClear();
});

describe("runIntegrationRoute — bearer extraction", () => {
  it("returns the uniform 401 body when the Authorization header is missing, without invoking the service", async () => {
    const invoke = vi.fn();
    const res = await runIntegrationRoute(makeRequest({ auth: null, method: "GET" }), {
      action: "api.v1.test",
      invoke,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(invoke).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not a bearer scheme", `Basic ${RAW_PAT}`],
    ["wrong prefix", "Bearer other_pat_abcdefghijklmnopqrstuvwxyz0123456789012345"],
    ["too short", "Bearer shyre_pat_short"],
    ["empty", ""],
  ])("returns the SAME uniform 401 body for a malformed header (%s) — no oracle", async (_label, auth) => {
    const invoke = vi.fn();
    const res = await runIntegrationRoute(makeRequest({ auth, method: "GET" }), {
      action: "api.v1.test",
      invoke,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("hands the service the sha256 hash, never the raw PAT", async () => {
    const invoke = vi.fn(async (): Promise<ServiceResult> => ({ ok: true, data: { fine: true } }));
    await runIntegrationRoute(makeRequest({ auth: `Bearer ${RAW_PAT}`, method: "GET" }), {
      action: "api.v1.test",
      invoke,
    });
    expect(invoke).toHaveBeenCalledWith(HASH, undefined);
    expect(JSON.stringify(invoke.mock.calls)).not.toContain(RAW_PAT);
  });
});

describe("runIntegrationRoute — responses", () => {
  it("returns the service data verbatim on success", async () => {
    const res = await runIntegrationRoute(makeRequest({ auth: `Bearer ${RAW_PAT}`, method: "GET" }), {
      action: "api.v1.test",
      invoke: async () => ({ ok: true, data: { id: "abc", nested: [1, 2] } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "abc", nested: [1, 2] });
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid_request"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "internal"],
  ] as const)("maps a %s service failure to { error: %s } and logs it", async (status, error) => {
    const res = await runIntegrationRoute(makeRequest({ auth: `Bearer ${RAW_PAT}`, method: "GET" }), {
      action: "api.v1.test",
      invoke: async () => ({ ok: false, status, error, message: "boom" }),
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the 401 body uniform even when the service supplies a reason", async () => {
    const res = await runIntegrationRoute(makeRequest({ auth: `Bearer ${RAW_PAT}`, method: "GET" }), {
      action: "api.v1.test",
      invoke: async () => ({
        ok: false,
        status: 401,
        error: "unauthorized",
        message: "token revoked three days ago",
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("forwards the conflict detail on 409 — agents must know why the write was refused", async () => {
    const res = await runIntegrationRoute(makeRequest({ auth: `Bearer ${RAW_PAT}`, method: "GET" }), {
      action: "api.v1.test",
      invoke: async () => ({
        ok: false,
        status: 409,
        error: "conflict",
        message: "timer already running",
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      message: "timer already running",
    });
  });
});

describe("runIntegrationRoute — body validation", () => {
  const schema = z.object({ project_id: z.uuid() }).strict();

  it("rejects a non-JSON body with 400 and logs", async () => {
    const res = await runIntegrationRoute(
      makeRequest({ auth: `Bearer ${RAW_PAT}`, rawBody: "not json {" }),
      { action: "api.v1.test", bodySchema: schema, invoke: vi.fn() },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown keys — schemas are strict, extra fields never pass through silently", async () => {
    const invoke = vi.fn();
    const res = await runIntegrationRoute(
      makeRequest({
        auth: `Bearer ${RAW_PAT}`,
        body: { project_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", user_id: "attacker" },
      }),
      { action: "api.v1.test", bodySchema: schema, invoke },
    );
    expect(res.status).toBe(400);
    expect(invoke).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("invalid_request");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("rejects invalid field values with issue paths", async () => {
    const res = await runIntegrationRoute(
      makeRequest({ auth: `Bearer ${RAW_PAT}`, body: { project_id: "not-a-uuid" } }),
      { action: "api.v1.test", bodySchema: schema, invoke: vi.fn() },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: Array<{ path: string }> };
    expect(body.issues.some((i) => i.path === "project_id")).toBe(true);
  });

  it("passes the parsed body to the service", async () => {
    const invoke = vi.fn(async (): Promise<ServiceResult> => ({ ok: true, data: null }));
    await runIntegrationRoute(
      makeRequest({
        auth: `Bearer ${RAW_PAT}`,
        body: { project_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" },
      }),
      { action: "api.v1.test", bodySchema: schema, invoke },
    );
    expect(invoke).toHaveBeenCalledWith(HASH, {
      project_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    });
  });
});

describe("runIntegrationRoute — redaction (SAL-051 pre-GA checklist)", () => {
  it("never logs the raw PAT: not on 401, not in failure messages, not in details", async () => {
    // Missing-auth log
    await runIntegrationRoute(makeRequest({ auth: null, method: "GET" }), {
      action: "api.v1.test",
      invoke: vi.fn(),
    });
    // Failure whose message embeds a PAT (worst case: DB error echoing input)
    await runIntegrationRoute(makeRequest({ auth: `Bearer ${RAW_PAT}`, method: "GET" }), {
      action: "api.v1.test",
      invoke: async () => ({
        ok: false,
        status: 500,
        error: "internal",
        message: `query failed for token ${RAW_PAT}`,
      }),
    });
    expect(logErrorMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(allLoggedText()).not.toContain(RAW_PAT);
  });

  it("redacts a PAT out of the 409 response detail", async () => {
    const res = await runIntegrationRoute(makeRequest({ auth: `Bearer ${RAW_PAT}`, method: "GET" }), {
      action: "api.v1.test",
      invoke: async () => ({
        ok: false,
        status: 409,
        error: "conflict",
        message: `conflicts with ${RAW_PAT}`,
      }),
    });
    const text = await res.text();
    expect(text).not.toContain(RAW_PAT);
    expect(text).toContain("shyre_pat_[REDACTED]");
  });

  it("logs only the display prefix as context, never the full token", async () => {
    await runIntegrationRoute(makeRequest({ auth: `Bearer ${RAW_PAT}`, method: "GET" }), {
      action: "api.v1.test",
      invoke: async () => ({ ok: false, status: 404, error: "not_found", message: "nope" }),
    });
    const [err] = logErrorMock.mock.calls[0] as [
      Error & { details?: Record<string, unknown> },
      Record<string, unknown>,
    ];
    expect(err.details?.tokenPrefix).toBe(RAW_PAT.slice(0, 16));
    expect(allLoggedText()).not.toContain(RAW_PAT);
  });
});
