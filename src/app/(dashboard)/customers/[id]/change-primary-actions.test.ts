import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tiny action — delegates to the `change_customer_primary_team`
 * RPC (which enforces auth + cross-team consent in SQL). We test
 * the wrapper: required-field gates, RPC call shape, error
 * propagation, revalidation.
 */

const fakeUserId = "u-author";

vi.mock("@/lib/safe-action", () => ({
  runSafeAction: async (
    formData: FormData,
    fn: (
      fd: FormData,
      ctx: { supabase: unknown; userId: string },
    ) => Promise<void>,
  ) => {
    await fn(formData, { supabase: mockSupabase(), userId: fakeUserId });
    return { success: true };
  },
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const state: {
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  rpcError: { message: string } | null;
} = { rpcCalls: [], rpcError: null };

function mockSupabase() {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: state.rpcError });
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import { changePrimaryTeamAction } from "./change-primary-actions";

function reset(): void {
  state.rpcCalls = [];
  state.rpcError = null;
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("changePrimaryTeamAction", () => {
  beforeEach(reset);

  it("calls change_customer_primary_team with both ids; revalidates the customer page and list", async () => {
    await changePrimaryTeamAction(
      fd({ customer_id: "c-1", new_team_id: "t-new" }),
    );
    expect(state.rpcCalls).toEqual([
      {
        name: "change_customer_primary_team",
        args: { p_customer_id: "c-1", p_new_team_id: "t-new" },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("rejects missing customer_id", async () => {
    await expect(
      changePrimaryTeamAction(fd({ new_team_id: "t-new" })),
    ).rejects.toThrow(/Client ID/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects missing new_team_id", async () => {
    await expect(
      changePrimaryTeamAction(fd({ customer_id: "c-1" })),
    ).rejects.toThrow(/New team/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("propagates RPC errors (e.g. consent rejection from the destination team)", async () => {
    state.rpcError = { message: "destination team has not consented" };
    await expect(
      changePrimaryTeamAction(
        fd({ customer_id: "c-1", new_team_id: "t-new" }),
      ),
    ).rejects.toThrow(/consented/);
  });

  it("does NOT revalidate when the RPC fails", async () => {
    state.rpcError = { message: "nope" };
    await expect(
      changePrimaryTeamAction(
        fd({ customer_id: "c-1", new_team_id: "t-new" }),
      ),
    ).rejects.toThrow();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
