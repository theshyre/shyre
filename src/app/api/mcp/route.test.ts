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

// Passthrough mock for mcp-auth with ONE seam: `tokenHashFromAuthInfo`
// can be forced to return null for a single test. That simulates the
// "authInfo lost between withMcpAuth and the tool closure" scenario the
// fail-closed branch in runTool defends against — unreachable through
// the HTTP surface (the wrapper rejects first), but load-bearing if a
// future refactor ever detaches a tool from the auth wrapper.
const tokenHashOverride: { value: "actual" | null } = { value: "actual" };
vi.mock("@/lib/integrations/mcp-auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/integrations/mcp-auth")>();
  return {
    ...actual,
    tokenHashFromAuthInfo: (
      authInfo: Parameters<typeof actual.tokenHashFromAuthInfo>[0],
    ) =>
      tokenHashOverride.value === null
        ? null
        : actual.tokenHashFromAuthInfo(authInfo),
  };
});

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

/** JSON-RPC tools/call request. The endpoint runs stateless (no
 *  sessionIdGenerator), so a tool call needs no initialize handshake —
 *  exactly how a retrying agent hits it in production. */
function toolCallRequest(
  name: string,
  args: Record<string, unknown>,
  auth: string | null = `Bearer ${RAW_PAT}`,
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  if (auth !== null) headers.set("authorization", auth);
  return new Request("https://shyre.test/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

interface JsonRpcToolEnvelope {
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/** Unwrap the streamable-HTTP response (SSE-framed or plain JSON)
 *  into the JSON-RPC envelope. */
async function parseRpcResponse(res: Response): Promise<JsonRpcToolEnvelope> {
  const text = await res.text();
  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data: "));
  const json = dataLine ? dataLine.slice("data: ".length) : text;
  return JSON.parse(json) as JsonRpcToolEnvelope;
}

function grantAllScopes(): void {
  serviceMocks.whoami.mockResolvedValue({
    ok: true,
    data: {
      user_id: "user-1",
      scopes: ["context:read", "timer:read", "timer:write", "entries:write"],
    },
  });
}

beforeEach(() => {
  logErrorMock.mockClear();
  tokenHashOverride.value = "actual";
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

describe("/api/mcp tool dispatch — snake_case wire args map to camelCase service inputs", () => {
  // These tests drive each tool through the real handler (auth wrapper,
  // zod schema, runTool, closure) and pin the exact object the service
  // layer receives. A mapping typo here (idempotency_key silently
  // dropped, force never forwarded) would double-bill agent time or
  // stop a human's timer — the wire contract is the test subject.
  const TOKEN_HASH = sha256Hex(RAW_PAT);
  const PROJECT_ID = "1b671a64-40d5-491e-99b0-da01ff1f3341";

  it("get_current_timer reaches getTimer with the token hash and returns the timer payload", async () => {
    grantAllScopes();
    serviceMocks.getTimer.mockResolvedValue({
      ok: true,
      data: { id: "entry-9", project_id: PROJECT_ID },
    });
    const res = await POST(toolCallRequest("get_current_timer", {}));
    expect(res.status).toBe(200);
    expect(serviceMocks.getTimer).toHaveBeenCalledExactlyOnceWith(TOKEN_HASH);
    const rpc = await parseRpcResponse(res);
    expect(rpc.result?.isError).toBeUndefined();
    const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as {
      id?: string;
    };
    expect(payload.id).toBe("entry-9");
  });

  it("list_projects reaches listProjects with the token hash", async () => {
    grantAllScopes();
    serviceMocks.listProjects.mockResolvedValue({
      ok: true,
      data: { projects: [{ id: PROJECT_ID, name: "Retainer" }] },
    });
    const res = await POST(toolCallRequest("list_projects", {}));
    expect(res.status).toBe(200);
    expect(serviceMocks.listProjects).toHaveBeenCalledExactlyOnceWith(
      TOKEN_HASH,
    );
  });

  it("start_timer maps every wire arg: project_id→projectId, session_ref→sessionRef, idempotency_key→idempotencyKey, agent_label→agentLabel", async () => {
    grantAllScopes();
    serviceMocks.startTimer.mockResolvedValue({
      ok: true,
      data: { id: "entry-1" },
    });
    const res = await POST(
      toolCallRequest("start_timer", {
        project_id: PROJECT_ID,
        description: "Refactoring the invoice PDF",
        agent_label: "Claude Code",
        session_ref: "sess-abc123",
        idempotency_key: "idem-start-1",
      }),
    );
    expect(res.status).toBe(200);
    expect(serviceMocks.startTimer).toHaveBeenCalledExactlyOnceWith(
      TOKEN_HASH,
      {
        projectId: PROJECT_ID,
        description: "Refactoring the invoice PDF",
        agentLabel: "Claude Code",
        sessionRef: "sess-abc123",
        idempotencyKey: "idem-start-1",
      },
    );
  });

  it("start_timer with only project_id leaves every optional service field unset", async () => {
    grantAllScopes();
    serviceMocks.startTimer.mockResolvedValue({
      ok: true,
      data: { id: "entry-2" },
    });
    await POST(toolCallRequest("start_timer", { project_id: PROJECT_ID }));
    // toEqual treats undefined-valued keys as absent — this pins that
    // no optional arg gets a surprise default on the way through.
    expect(serviceMocks.startTimer).toHaveBeenCalledExactlyOnceWith(
      TOKEN_HASH,
      { projectId: PROJECT_ID },
    );
  });

  it("stop_timer forwards description and the force flag (the human-timer override)", async () => {
    grantAllScopes();
    serviceMocks.stopTimer.mockResolvedValue({
      ok: true,
      data: { id: "entry-3", end_time: "2026-07-19T10:00:00Z" },
    });
    await POST(
      toolCallRequest("stop_timer", {
        description: "Shipped the fix",
        force: true,
      }),
    );
    expect(serviceMocks.stopTimer).toHaveBeenCalledExactlyOnceWith(
      TOKEN_HASH,
      { description: "Shipped the fix", force: true },
    );
  });

  it("stop_timer with no args never fabricates force=true", async () => {
    grantAllScopes();
    serviceMocks.stopTimer.mockResolvedValue({
      ok: true,
      data: { id: "entry-4" },
    });
    await POST(toolCallRequest("stop_timer", {}));
    expect(serviceMocks.stopTimer).toHaveBeenCalledExactlyOnceWith(
      TOKEN_HASH,
      {},
    );
  });

  it("log_time_entry maps the full arg set including billable=false and idempotency_key", async () => {
    grantAllScopes();
    serviceMocks.logEntry.mockResolvedValue({
      ok: true,
      data: { id: "entry-5" },
    });
    await POST(
      toolCallRequest("log_time_entry", {
        project_id: PROJECT_ID,
        start_time: "2026-07-18T14:00:00Z",
        end_time: "2026-07-18T16:30:00Z",
        description: "Implemented the export endpoint",
        agent_label: "Claude Code",
        session_ref: "sess-def456",
        idempotency_key: "idem-log-1",
        billable: false,
      }),
    );
    expect(serviceMocks.logEntry).toHaveBeenCalledExactlyOnceWith(
      TOKEN_HASH,
      {
        projectId: PROJECT_ID,
        startTime: "2026-07-18T14:00:00Z",
        endTime: "2026-07-18T16:30:00Z",
        description: "Implemented the export endpoint",
        agentLabel: "Claude Code",
        sessionRef: "sess-def456",
        idempotencyKey: "idem-log-1",
        // billable=false must survive the mapping — a truthiness check
        // anywhere in the chain would flip it back to the token default.
        billable: false,
      },
    );
  });

  it("a service-layer conflict (409) surfaces as an isError tool result and is logged", async () => {
    grantAllScopes();
    serviceMocks.startTimer.mockResolvedValue({
      ok: false,
      status: 409,
      error: "conflict",
      message: "a timer is already running",
    });
    const res = await POST(
      toolCallRequest("start_timer", { project_id: PROJECT_ID }),
    );
    expect(res.status).toBe(200);
    const rpc = await parseRpcResponse(res);
    expect(rpc.result?.isError).toBe(true);
    const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as {
      error?: string;
      message?: string;
    };
    expect(payload.error).toBe("conflict");
    expect(payload.message).toContain("already running");
    // Failures must land in the audit trail (SAL-051).
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("a schema-invalid project_id is rejected before the service layer runs", async () => {
    grantAllScopes();
    const res = await POST(
      toolCallRequest("start_timer", { project_id: "not-a-uuid" }),
    );
    const rpc = await parseRpcResponse(res);
    // The SDK reports zod failures as an error (JSON-RPC error or
    // isError result depending on version) — either way the service
    // must never see the malformed input.
    expect(Boolean(rpc.error) || rpc.result?.isError === true).toBe(true);
    expect(serviceMocks.startTimer).not.toHaveBeenCalled();
  });

  it("runTool fails closed with a uniform unauthorized result when authInfo is missing", async () => {
    grantAllScopes();
    serviceMocks.getTimer.mockResolvedValue({
      ok: true,
      data: { id: "should-never-be-returned" },
    });
    // Simulate the wrapper→tool handoff losing authInfo. The tool must
    // refuse on its own rather than trusting the wrapper ran.
    tokenHashOverride.value = null;
    const res = await POST(toolCallRequest("get_current_timer", {}));
    const rpc = await parseRpcResponse(res);
    expect(rpc.result?.isError).toBe(true);
    const payload = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as {
      error?: string;
      message?: string;
    };
    expect(payload.error).toBe("unauthorized");
    // Uniform no-oracle message — never the internal "missing auth
    // info" detail.
    expect(payload.message).toBe("unauthorized");
    expect(serviceMocks.getTimer).not.toHaveBeenCalled();
  });
});
