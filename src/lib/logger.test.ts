import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * logger.ts is fire-and-forget. It must:
 *   - skip info-severity (deliberate refusals)
 *   - prefer the admin-client path
 *   - fall back to the RPC when admin client throws
 *   - never throw even when both paths fail
 */

const adminInsertMock = vi.fn();
const adminThrows = { value: false };
const rpcMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (adminThrows.value) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
    }
    return {
      from: () => ({ insert: adminInsertMock }),
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: rpcMock }),
}));

import { logError } from "./logger";
import { AppError } from "./errors";

beforeEach(() => {
  adminInsertMock.mockReset();
  rpcMock.mockReset();
  adminThrows.value = false;
});

// Helper to wait for the next microtask so the fire-and-forget
// promise has a chance to run.
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("logError", () => {
  it("writes via the admin client on the happy path", async () => {
    adminInsertMock.mockResolvedValue({ error: null });
    logError(AppError.notFound("Invoice"), {
      userId: "u-1",
      teamId: "t-1",
      action: "test",
    });
    await flush();
    expect(adminInsertMock).toHaveBeenCalledTimes(1);
    const row = adminInsertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.error_code).toBe("NOT_FOUND");
    expect(row.user_id).toBe("u-1");
    expect(row.team_id).toBe("t-1");
    expect(row.action).toBe("test");
  });

  it("skips entirely on severity='info' (refusal pattern)", async () => {
    logError(AppError.refusal("Invoice not voided"));
    await flush();
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("falls back to the RPC when admin client throws", async () => {
    adminThrows.value = true;
    rpcMock.mockResolvedValue({ error: null });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    logError(new Error("boom"));
    await flush();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]?.[0]).toBe("log_error_from_user");
    consoleSpy.mockRestore();
  });

  it("falls through to RPC when admin insert returns an error (only success short-circuits)", async () => {
    adminInsertMock.mockResolvedValue({
      error: { message: "RLS rejected" },
    });
    rpcMock.mockResolvedValue({ error: null });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    logError(new Error("boom"));
    await flush();
    expect(adminInsertMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it("never throws even when BOTH paths fail (final fallback to console)", async () => {
    adminThrows.value = true;
    rpcMock.mockRejectedValue(new Error("RPC also down"));
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    expect(() => logError(new Error("boom"))).not.toThrow();
    await flush();
    consoleSpy.mockRestore();
  });

  it("normalizes a plain Error via toAppError (code='UNKNOWN')", async () => {
    adminInsertMock.mockResolvedValue({ error: null });
    logError(new Error("plain"));
    await flush();
    expect(adminInsertMock).toHaveBeenCalledTimes(1);
    const row = adminInsertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.error_code).toBe("UNKNOWN");
    expect(row.message).toBe("plain");
  });

  it("uses empty context when none is provided", async () => {
    adminInsertMock.mockResolvedValue({ error: null });
    logError(AppError.notFound());
    await flush();
    const row = adminInsertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.user_id).toBeNull();
    expect(row.team_id).toBeNull();
    expect(row.url).toBeNull();
    expect(row.action).toBeNull();
  });
});
