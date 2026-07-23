import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpcMock = vi.fn();
const createClientMock = vi.fn((..._args: unknown[]) => ({ rpc: rpcMock }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import {
  createIntegrationClient,
  deleteEntry,
  getEntry,
  getTimer,
  listEntries,
  listProjects,
  logEntry,
  startTimer,
  stopTimer,
  updateEntry,
  whoami,
} from "./service";

const HASH = "f".repeat(64);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  rpcMock.mockReset();
  createClientMock.mockClear();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createIntegrationClient", () => {
  it("builds a bare session-less anon client from public env vars", () => {
    createIntegrationClient();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  it("throws loudly when env vars are missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(() => createIntegrationClient()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe("service functions — RPC wiring", () => {
  it("whoami calls api_whoami with the hash only", async () => {
    rpcMock.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    const result = await whoami(HASH);
    expect(rpcMock).toHaveBeenCalledWith("api_whoami", { p_token_hash: HASH });
    expect(result).toEqual({ ok: true, data: { user_id: "u1" } });
  });

  it("listProjects calls api_list_projects and passes the JSONB array through", async () => {
    rpcMock.mockResolvedValue({ data: [{ id: "p1", name: "Atlas" }], error: null });
    const result = await listProjects(HASH);
    expect(rpcMock).toHaveBeenCalledWith("api_list_projects", { p_token_hash: HASH });
    expect(result).toEqual({ ok: true, data: [{ id: "p1", name: "Atlas" }] });
  });

  it("getTimer maps a JSON null (no running timer) to data: null", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await getTimer(HASH);
    expect(rpcMock).toHaveBeenCalledWith("api_get_timer", { p_token_hash: HASH });
    expect(result).toEqual({ ok: true, data: null });
  });

  it("startTimer omits undefined optionals so SQL defaults apply (agent_label default 'Claude Code')", async () => {
    await startTimer(HASH, { projectId: "proj-1" });
    expect(rpcMock).toHaveBeenCalledWith("api_start_timer", {
      p_token_hash: HASH,
      p_project_id: "proj-1",
    });
  });

  it("startTimer forwards every provided optional", async () => {
    await startTimer(HASH, {
      projectId: "proj-1",
      description: "refactor",
      agentLabel: "My Agent",
      sessionRef: "sess-9",
      idempotencyKey: "idem-1",
    });
    expect(rpcMock).toHaveBeenCalledWith("api_start_timer", {
      p_token_hash: HASH,
      p_project_id: "proj-1",
      p_description: "refactor",
      p_agent_label: "My Agent",
      p_session_ref: "sess-9",
      p_idem_key: "idem-1",
    });
  });

  it("stopTimer forwards description and force", async () => {
    await stopTimer(HASH, { description: "done", force: true });
    expect(rpcMock).toHaveBeenCalledWith("api_stop_timer", {
      p_token_hash: HASH,
      p_description: "done",
      p_force: true,
    });
  });

  it("logEntry forwards the full time range and billable override", async () => {
    await logEntry(HASH, {
      projectId: "proj-1",
      startTime: "2026-07-18T14:00:00Z",
      endTime: "2026-07-18T15:30:00Z",
      description: "shipped the integration docs",
      billable: false,
    });
    expect(rpcMock).toHaveBeenCalledWith("api_log_entry", {
      p_token_hash: HASH,
      p_project_id: "proj-1",
      p_start_time: "2026-07-18T14:00:00Z",
      p_end_time: "2026-07-18T15:30:00Z",
      p_description: "shipped the integration docs",
      p_billable: false,
    });
  });

  it("logEntry forwards an explicit category id as p_category_id", async () => {
    await logEntry(HASH, {
      projectId: "proj-1",
      startTime: "2026-07-18T14:00:00Z",
      endTime: "2026-07-18T15:30:00Z",
      description: "shipped the integration docs",
      categoryId: "cat-9",
    });
    expect(rpcMock).toHaveBeenCalledWith("api_log_entry", {
      p_token_hash: HASH,
      p_project_id: "proj-1",
      p_start_time: "2026-07-18T14:00:00Z",
      p_end_time: "2026-07-18T15:30:00Z",
      p_description: "shipped the integration docs",
      p_category_id: "cat-9",
    });
  });

  it("logEntry omits p_category_id when no category is given (project default applies)", async () => {
    await logEntry(HASH, {
      projectId: "proj-1",
      startTime: "2026-07-18T14:00:00Z",
      endTime: "2026-07-18T15:30:00Z",
      description: "shipped the integration docs",
    });
    const call = rpcMock.mock.calls.at(-1);
    expect(call?.[1]).not.toHaveProperty("p_category_id");
  });
});

describe("service functions — ERRCODE mapping", () => {
  it.each([
    ["TK400", 400, "invalid_request"],
    ["TK401", 401, "unauthorized"],
    ["TK403", 403, "forbidden"],
    ["TK404", 404, "not_found"],
    ["TK409", 409, "conflict"],
    ["TK429", 429, "rate_limited"],
  ] as const)("maps Postgres ERRCODE %s to %s/%s", async (code, status, error) => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code, message: "raised by the RPC" },
    });
    const result = await whoami(HASH);
    expect(result).toEqual({
      ok: false,
      status,
      error,
      message: "raised by the RPC",
    });
  });

  it("maps any unknown error code (incl. trigger TK001/TK002) to a 500 internal failure", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "TK001", message: "integration tokens are immutable" },
    });
    const result = await whoami(HASH);
    expect(result).toMatchObject({ ok: false, status: 500, error: "internal" });
  });

  it("maps a thrown network failure to a 500 internal failure instead of leaking the exception", async () => {
    rpcMock.mockRejectedValue(new Error("fetch failed"));
    const result = await getTimer(HASH);
    expect(result).toMatchObject({ ok: false, status: 500, error: "internal", message: "fetch failed" });
  });

  it("redacts any PAT that leaks into an error message", async () => {
    const raw = `shyre_pat_${"b".repeat(43)}`;
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: `something broke near ${raw}` },
    });
    const result = await whoami(HASH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain(raw);
      expect(result.message).toContain("shyre_pat_[REDACTED]");
    }
  });

  it("surfaces missing env config as a 500 failure, not an unhandled throw", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const result = await whoami(HASH);
    expect(result).toMatchObject({ ok: false, status: 500, error: "internal" });
  });

  it("getEntry forwards the entry id", async () => {
    await getEntry(HASH, "entry-1");
    expect(rpcMock).toHaveBeenCalledWith("api_get_entry", {
      p_token_hash: HASH,
      p_entry_id: "entry-1",
    });
  });

  it("listEntries forwards the filters, compacting undefined ones", async () => {
    await listEntries(HASH, { projectId: "proj-1", limit: 50 });
    expect(rpcMock).toHaveBeenCalledWith("api_list_entries", {
      p_token_hash: HASH,
      p_project_id: "proj-1",
      p_limit: 50,
    });
  });

  it("updateEntry forwards only the provided fields (partial patch)", async () => {
    await updateEntry(HASH, "entry-1", { endTime: "2026-07-23T15:00:00Z", categoryId: "cat-2" });
    expect(rpcMock).toHaveBeenCalledWith("api_update_entry", {
      p_token_hash: HASH,
      p_entry_id: "entry-1",
      p_end_time: "2026-07-23T15:00:00Z",
      p_category_id: "cat-2",
    });
  });

  it("deleteEntry forwards the entry id", async () => {
    await deleteEntry(HASH, "entry-1");
    expect(rpcMock).toHaveBeenCalledWith("api_delete_entry", {
      p_token_hash: HASH,
      p_entry_id: "entry-1",
    });
  });
});
