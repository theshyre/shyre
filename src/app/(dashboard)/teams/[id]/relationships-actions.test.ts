import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The three relationship actions all delegate the actual write to
 * Postgres RPCs (`propose_team_share`, `accept_team_share`) or a
 * direct DELETE on `team_shares`. The RPCs are SECURITY DEFINER and
 * enforce ownership/role themselves — these tests verify the
 * action-layer wiring (required-field gates, RPC call shape, error
 * propagation, revalidation paths) which is all we own in
 * application code.
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

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

const state: {
  rpcCalls: RpcCall[];
  rpcError: { message: string } | null;
  deletes: { table: string; filters: Filter[] }[];
  deleteError: { message: string } | null;
} = {
  rpcCalls: [],
  rpcError: null,
  deletes: [],
  deleteError: null,
};

function mockSupabase() {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: state.rpcError });
    },
    from: (table: string) => {
      const op: { kind: "delete" | null; filters: Filter[] } = {
        kind: null,
        filters: [],
      };
      const chain: Record<string, unknown> = {
        delete() {
          op.kind = "delete";
          return chain;
        },
        eq(col: string, value: unknown) {
          op.filters.push({ col, op: "eq", value });
          return chain;
        },
        then(resolve: (v: { data: null; error: unknown }) => void) {
          if (op.kind === "delete") {
            state.deletes.push({ table, filters: [...op.filters] });
          }
          resolve({ data: null, error: state.deleteError });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  acceptTeamShareAction,
  proposeTeamShareAction,
  removeTeamShareAction,
} from "./relationships-actions";

function reset(): void {
  state.rpcCalls = [];
  state.rpcError = null;
  state.deletes = [];
  state.deleteError = null;
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("proposeTeamShareAction", () => {
  beforeEach(reset);

  it("calls propose_team_share with all three params; revalidates both teams", async () => {
    await proposeTeamShareAction(
      fd({
        parent_team_id: "t-parent",
        child_team_id: "t-child",
        sharing_level: "read",
      }),
    );
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]).toEqual({
      name: "propose_team_share",
      args: {
        p_parent_team_id: "t-parent",
        p_child_team_id: "t-child",
        p_sharing_level: "read",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t-parent");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t-child");
  });

  it.each([
    [{ child_team_id: "t-child", sharing_level: "read" }, /Parent team/],
    [{ parent_team_id: "t-parent", sharing_level: "read" }, /Child team/],
    [{ parent_team_id: "t-parent", child_team_id: "t-child" }, /Sharing level/],
  ])("rejects missing required field", async (entries, pattern) => {
    await expect(
      proposeTeamShareAction(fd(entries as Record<string, string>)),
    ).rejects.toThrow(pattern);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("propagates RPC errors verbatim (e.g. RLS rejection of unauthorized parent-team admin)", async () => {
    state.rpcError = { message: "permission denied to propose share" };
    await expect(
      proposeTeamShareAction(
        fd({
          parent_team_id: "t-parent",
          child_team_id: "t-child",
          sharing_level: "read",
        }),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("acceptTeamShareAction", () => {
  beforeEach(reset);

  it("calls accept_team_share with the share id; revalidates the recipient team page when team_id is provided", async () => {
    await acceptTeamShareAction(
      fd({ share_id: "s-1", team_id: "t-recipient" }),
    );
    expect(state.rpcCalls).toEqual([
      { name: "accept_team_share", args: { p_share_id: "s-1" } },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t-recipient");
  });

  it("works without team_id (skips revalidation but still calls the RPC)", async () => {
    await acceptTeamShareAction(fd({ share_id: "s-1" }));
    expect(state.rpcCalls).toHaveLength(1);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects missing share_id", async () => {
    await expect(acceptTeamShareAction(fd({}))).rejects.toThrow(/Share ID/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("propagates RPC errors", async () => {
    state.rpcError = { message: "share already accepted" };
    await expect(
      acceptTeamShareAction(fd({ share_id: "s-1" })),
    ).rejects.toThrow(/already accepted/);
  });
});

describe("removeTeamShareAction", () => {
  beforeEach(reset);

  it("deletes the team_shares row scoped to share id; revalidates the team page when provided", async () => {
    await removeTeamShareAction(
      fd({ share_id: "s-1", team_id: "t-r" }),
    );
    expect(state.deletes).toEqual([
      { table: "team_shares", filters: [{ col: "id", op: "eq", value: "s-1" }] },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t-r");
  });

  it("works without team_id (no revalidation, but still deletes)", async () => {
    await removeTeamShareAction(fd({ share_id: "s-1" }));
    expect(state.deletes).toHaveLength(1);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects missing share_id without firing a delete", async () => {
    await expect(removeTeamShareAction(fd({}))).rejects.toThrow(/Share ID/);
    expect(state.deletes).toHaveLength(0);
  });

  it("propagates DB errors", async () => {
    state.deleteError = { message: "RLS rejected delete" };
    await expect(
      removeTeamShareAction(fd({ share_id: "s-1" })),
    ).rejects.toThrow(/RLS rejected/);
  });
});
