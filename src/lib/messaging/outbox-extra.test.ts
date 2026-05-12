import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Companion to `outbox.test.ts`. The original file covers enqueue +
 * drain (the queued → sending → sent state machine). This file
 * covers the remaining four exports:
 *
 *   - recordEvent  — webhook ingestion + status-flip side effects
 *   - loadTeamConfig — team_email_config maybeSingle path
 *   - assertFromDomainAllowed — verified_email_domains gate
 *   - reapStuckOutboxSends — admin RPC + audit log
 *
 * Mocks the admin client at the module boundary so the test only
 * exercises pure logic.
 */

const adminInsertMock = vi.fn();
const adminUpdateMock = vi.fn();
const adminRpcMock = vi.fn();
const adminFromMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      adminFromMock(table);
      return {
        insert: (row: unknown) => Promise.resolve(adminInsertMock(row)),
        update: (patch: unknown) => ({
          eq: (..._args: unknown[]) =>
            Promise.resolve(adminUpdateMock(patch, _args)),
        }),
      };
    },
    rpc: (fn: string, args: unknown) =>
      Promise.resolve(adminRpcMock(fn, args)),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

import {
  recordEvent,
  loadTeamConfig,
  assertFromDomainAllowed,
  reapStuckOutboxSends,
} from "./outbox";

beforeEach(() => {
  adminInsertMock.mockReset();
  adminUpdateMock.mockReset();
  adminRpcMock.mockReset();
  adminFromMock.mockReset();
  logErrorMock.mockReset();
});

describe("recordEvent", () => {
  it("returns true on first-time insert and skips status flip for untracked event types", async () => {
    adminInsertMock.mockReturnValue({ error: null });
    const result = await recordEvent(
      "outbox-1",
      "email.opened",
      { foo: "bar" },
      "svix-1",
    );
    expect(result).toBe(true);
    // email.opened is not in mapEventToStatus → no status update.
    expect(adminUpdateMock).not.toHaveBeenCalled();
  });

  it("flips status to 'delivered' on email.delivered", async () => {
    adminInsertMock.mockReturnValue({ error: null });
    await recordEvent("outbox-1", "email.delivered", {});
    expect(adminUpdateMock).toHaveBeenCalled();
    const patch = adminUpdateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.status).toBe("delivered");
    expect(patch.delivered_at).toEqual(expect.any(String));
    expect(patch.last_event_at).toEqual(expect.any(String));
  });

  it("flips status to 'bounced' with hard bounce_type on email.bounced", async () => {
    adminInsertMock.mockReturnValue({ error: null });
    await recordEvent("outbox-1", "email.bounced", {});
    const patch = adminUpdateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.status).toBe("bounced");
    expect(patch.bounce_type).toBe("hard");
  });

  it("flips status to 'complained' on email.complained", async () => {
    adminInsertMock.mockReturnValue({ error: null });
    await recordEvent("outbox-1", "email.complained", {});
    const patch = adminUpdateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.status).toBe("complained");
  });

  it("returns false on svix_id collision (23505) — idempotent dedupe", async () => {
    adminInsertMock.mockReturnValue({
      error: { code: "23505", message: "duplicate key" },
    });
    const result = await recordEvent("outbox-1", "email.delivered", {}, "svix-dup");
    expect(result).toBe(false);
    // No downstream status flip when the event was already recorded.
    expect(adminUpdateMock).not.toHaveBeenCalled();
  });

  it("throws on any other insert error (not 23505)", async () => {
    adminInsertMock.mockReturnValue({
      error: { code: "42P01", message: "table missing" },
    });
    await expect(
      recordEvent("outbox-1", "email.delivered", {}),
    ).rejects.toMatchObject({ message: "table missing" });
  });

  it("normalizes a missing svix_id to null on the inserted row", async () => {
    adminInsertMock.mockReturnValue({ error: null });
    await recordEvent("outbox-1", "email.opened", { foo: "bar" });
    const row = adminInsertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.svix_id).toBeNull();
    expect(row.outbox_id).toBe("outbox-1");
    expect(row.event_type).toBe("email.opened");
  });
});

// loadTeamConfig + assertFromDomainAllowed take a SupabaseClient
// directly, so we hand them a small fluent fake instead of going
// through the admin-client mock.
interface FakeTableResult {
  data: unknown;
  error: null;
}
function fakeSupabaseFor(rowByTable: Record<string, unknown>): {
  from: (tbl: string) => {
    select: () => {
      eq: () => {
        eq?: () => { maybeSingle: () => Promise<FakeTableResult> };
        maybeSingle: () => Promise<FakeTableResult>;
      };
    };
  };
} {
  return {
    from: (tbl: string) => {
      const row = rowByTable[tbl] ?? null;
      const result = { data: row, error: null as null };
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve(result) }),
            maybeSingle: () => Promise.resolve(result),
          }),
        }),
      };
    },
  };
}

describe("loadTeamConfig", () => {
  it("returns null when the team has no email config row", async () => {
    const supabase = fakeSupabaseFor({ team_email_config: null });
    const cfg = await loadTeamConfig(
      supabase as unknown as Parameters<typeof loadTeamConfig>[0],
      "team-x",
    );
    expect(cfg).toBeNull();
  });

  it("returns a normalized shape when the row exists", async () => {
    const supabase = fakeSupabaseFor({
      team_email_config: {
        api_key_encrypted: "<cipher>",
        from_email: "billing@example.com",
        from_name: "Marcus",
        reply_to_email: "reply@example.com",
        signature: "—",
      },
    });
    const cfg = await loadTeamConfig(
      supabase as unknown as Parameters<typeof loadTeamConfig>[0],
      "team-1",
    );
    expect(cfg).toEqual({
      apiKeyCipher: "<cipher>",
      fromEmail: "billing@example.com",
      fromName: "Marcus",
      replyToEmail: "reply@example.com",
      signature: "—",
    });
  });

  it("normalizes missing fields to null", async () => {
    const supabase = fakeSupabaseFor({
      team_email_config: {
        api_key_encrypted: null,
        from_email: null,
        from_name: null,
        reply_to_email: null,
        signature: null,
      },
    });
    const cfg = await loadTeamConfig(
      supabase as unknown as Parameters<typeof loadTeamConfig>[0],
      "team-1",
    );
    expect(cfg).toEqual({
      apiKeyCipher: null,
      fromEmail: null,
      fromName: null,
      replyToEmail: null,
      signature: null,
    });
  });
});

describe("assertFromDomainAllowed", () => {
  it("rejects when the from-email has no @ (defensive)", async () => {
    const supabase = fakeSupabaseFor({ verified_email_domains: null });
    await expect(
      assertFromDomainAllowed(
        supabase as unknown as Parameters<typeof assertFromDomainAllowed>[0],
        "team-1",
        "no-at-symbol",
      ),
    ).rejects.toThrow(/no domain/);
  });

  it("rejects when the domain row is missing", async () => {
    const supabase = fakeSupabaseFor({ verified_email_domains: null });
    await expect(
      assertFromDomainAllowed(
        supabase as unknown as Parameters<typeof assertFromDomainAllowed>[0],
        "team-1",
        "x@unverified.test",
      ),
    ).rejects.toThrow(/not verified/);
  });

  it("rejects when the domain row exists but status !== 'verified'", async () => {
    const supabase = fakeSupabaseFor({
      verified_email_domains: { id: "d-1", status: "pending" },
    });
    await expect(
      assertFromDomainAllowed(
        supabase as unknown as Parameters<typeof assertFromDomainAllowed>[0],
        "team-1",
        "x@pending.test",
      ),
    ).rejects.toThrow(/not verified/);
  });

  it("resolves when the domain is verified", async () => {
    const supabase = fakeSupabaseFor({
      verified_email_domains: { id: "d-1", status: "verified" },
    });
    await expect(
      assertFromDomainAllowed(
        supabase as unknown as Parameters<typeof assertFromDomainAllowed>[0],
        "team-1",
        "x@verified.test",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("reapStuckOutboxSends", () => {
  it("calls the RPC with the cutoff_minutes parameter (default 5)", async () => {
    adminRpcMock.mockReturnValue({ data: 0, error: null });
    await reapStuckOutboxSends();
    expect(adminRpcMock).toHaveBeenCalledWith("reap_stuck_outbox_sends", {
      p_cutoff_minutes: 5,
    });
  });

  it("returns the reaped row count", async () => {
    adminRpcMock.mockReturnValue({ data: 3, error: null });
    const n = await reapStuckOutboxSends(10);
    expect(n).toBe(3);
    expect(adminRpcMock).toHaveBeenCalledWith("reap_stuck_outbox_sends", {
      p_cutoff_minutes: 10,
    });
  });

  it("returns 0 when the RPC returns null data", async () => {
    adminRpcMock.mockReturnValue({ data: null, error: null });
    const n = await reapStuckOutboxSends();
    expect(n).toBe(0);
  });

  it("logs (audit) when count > 0", async () => {
    adminRpcMock.mockReturnValue({ data: 2, error: null });
    await reapStuckOutboxSends();
    // logError is called twice on RPC error, once for the audit log
    // when count > 0. Here only the audit call should fire.
    const auditCalls = logErrorMock.mock.calls.filter((c) =>
      String((c[0] as Error).message).includes("Reaped"),
    );
    expect(auditCalls.length).toBe(1);
  });

  it("does not log audit when count == 0", async () => {
    adminRpcMock.mockReturnValue({ data: 0, error: null });
    await reapStuckOutboxSends();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("throws + logs when the RPC errors", async () => {
    adminRpcMock.mockReturnValue({
      data: null,
      error: { message: "permission denied" },
    });
    await expect(reapStuckOutboxSends()).rejects.toThrow(
      /Failed to reap stuck outbox sends.*permission denied/,
    );
    expect(logErrorMock).toHaveBeenCalled();
  });
});
