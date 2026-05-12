import { describe, it, expect, vi } from "vitest";
import { consumeDailyQuota } from "./rate-limit";

/**
 * `consumeDailyQuota` is the fail-closed quota gate (SAL-021). The
 * RPC is the source of truth; this wrapper translates the SETOF row
 * into a typed decision. Tests:
 *
 *   - happy paths: allowed + remaining math
 *   - RPC error → fails closed (treated as over-cap, NOT allowed)
 *   - empty SETOF (no config row) → no_config rejection
 *   - reason field is omitted from the result when null on the row
 *     (the type contract uses an optional field, not a nullable one)
 */

function mockClient(opts: {
  data?: Array<{
    allowed: boolean;
    reason: string | null;
    remaining: number;
    cap: number;
  }> | null;
  error?: { message: string } | null;
}) {
  return {
    rpc: vi.fn(() =>
      Promise.resolve({
        data: opts.data ?? null,
        error: opts.error ?? null,
      }),
    ),
  };
}

describe("consumeDailyQuota", () => {
  it("returns allowed=true with remaining + cap on a happy-path send", async () => {
    const supabase = mockClient({
      data: [{ allowed: true, reason: null, remaining: 95, cap: 100 }],
    });
    const result = await consumeDailyQuota(
      supabase as never,
      "t-1",
      5,
    );
    expect(result).toEqual({
      allowed: true,
      remaining: 95,
      cap: 100,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("consume_daily_quota", {
      p_team_id: "t-1",
      p_amount: 5,
    });
  });

  it("defaults recipientCount to 1 when omitted (legacy callers)", async () => {
    const supabase = mockClient({
      data: [{ allowed: true, reason: null, remaining: 99, cap: 100 }],
    });
    await consumeDailyQuota(supabase as never, "t-1");
    expect(supabase.rpc).toHaveBeenCalledWith("consume_daily_quota", {
      p_team_id: "t-1",
      p_amount: 1,
    });
  });

  it("over-cap returns allowed=false with reason='cap_reached' and remaining slack", async () => {
    const supabase = mockClient({
      data: [
        { allowed: false, reason: "cap_reached", remaining: 0, cap: 100 },
      ],
    });
    const result = await consumeDailyQuota(
      supabase as never,
      "t-1",
      1,
    );
    expect(result).toEqual({
      allowed: false,
      reason: "cap_reached",
      remaining: 0,
      cap: 100,
    });
  });

  it("missing config row → allowed=false with reason='no_config'", async () => {
    const supabase = mockClient({ data: [] });
    const result = await consumeDailyQuota(supabase as never, "t-1");
    expect(result).toEqual({
      allowed: false,
      reason: "no_config",
      remaining: 0,
      cap: 0,
    });
  });

  it("null data → allowed=false with reason='no_config'", async () => {
    const supabase = mockClient({ data: null });
    const result = await consumeDailyQuota(supabase as never, "t-1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_config");
  });

  it("FAIL-CLOSED: RPC error → allowed=false with reason='cap_reached' (SAL-021 invariant)", async () => {
    const supabase = mockClient({
      data: null,
      error: { message: "RLS rejected the RPC" },
    });
    const result = await consumeDailyQuota(supabase as never, "t-1");
    // Critical invariant: a broken RPC must NOT silently let traffic
    // through. Treat as over-cap so the abuse vector stays closed.
    expect(result).toEqual({
      allowed: false,
      reason: "cap_reached",
      remaining: 0,
      cap: 0,
    });
  });

  it("omits the reason field on allowed=true rows (typed as optional, not nullable)", async () => {
    const supabase = mockClient({
      data: [{ allowed: true, reason: null, remaining: 50, cap: 100 }],
    });
    const result = await consumeDailyQuota(supabase as never, "t-1");
    expect(result).not.toHaveProperty("reason");
  });
});
