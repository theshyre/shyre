import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockValidateTeamAccess = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (...args: unknown[]) =>
    mockValidateTeamAccess(...args),
  isTeamAdmin: (role: string) => role === "owner" || role === "admin",
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const state: {
  rpcCalls: { name: string; args: unknown }[];
  rpcError: { message: string } | null;
  /** What `.from("user_profiles").select("display_name").eq("user_id",
   *  uid).maybeSingle()` returns when transferOwnershipAction looks
   *  up the target's name for the typed-confirm comparison. */
  targetProfile: { display_name: string | null } | null;
} = {
  rpcCalls: [],
  rpcError: null,
  targetProfile: null,
};

function mockSupabase() {
  return {
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: state.rpcError });
    },
    from: (table: string) => {
      if (table !== "user_profiles") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: state.targetProfile }),
          }),
        }),
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  transferOwnershipAction,
  updateMemberRoleAction,
} from "./team-actions";

function reset(): void {
  state.rpcCalls = [];
  state.rpcError = null;
  state.targetProfile = null;
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("transferOwnershipAction", () => {
  beforeEach(reset);

  it("calls transfer_team_ownership when caller is owner and the typed name matches", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.targetProfile = { display_name: "Alex Park" };

    await transferOwnershipAction(
      fd({
        team_id: "team-1",
        new_owner_user_id: "u-target",
        confirm_name: "Alex Park",
      }),
    );

    expect(state.rpcCalls).toEqual([
      {
        name: "transfer_team_ownership",
        args: { p_team_id: "team-1", p_new_owner_user_id: "u-target" },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/team-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams");
  });

  it("matches the typed name case-insensitively", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.targetProfile = { display_name: "Alex Park" };

    await transferOwnershipAction(
      fd({
        team_id: "team-1",
        new_owner_user_id: "u-target",
        confirm_name: "alex park",
      }),
    );

    expect(state.rpcCalls).toHaveLength(1);
  });

  it("refuses when caller is admin (only the owner can transfer)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    state.targetProfile = { display_name: "Alex" };

    await expect(
      transferOwnershipAction(
        fd({
          team_id: "team-1",
          new_owner_user_id: "u-target",
          confirm_name: "Alex",
        }),
      ),
    ).rejects.toThrow(/owner/i);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("refuses when the typed name does not match", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.targetProfile = { display_name: "Alex Park" };

    await expect(
      transferOwnershipAction(
        fd({
          team_id: "team-1",
          new_owner_user_id: "u-target",
          confirm_name: "Bob",
        }),
      ),
    ).rejects.toThrow(/Alex Park/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects without team_id (no profile lookup, no rpc)", async () => {
    await expect(
      transferOwnershipAction(
        fd({ new_owner_user_id: "u-target", confirm_name: "x" }),
      ),
    ).rejects.toThrow(/team_id is required/);
    expect(state.rpcCalls).toHaveLength(0);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
  });

  it("rejects without new_owner_user_id", async () => {
    await expect(
      transferOwnershipAction(
        fd({ team_id: "team-1", confirm_name: "x" }),
      ),
    ).rejects.toThrow(/Pick a member/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("propagates a Postgres error from the RPC", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.targetProfile = { display_name: "Alex" };
    state.rpcError = {
      message: "transfer_team_ownership: target is a shell account",
    };

    await expect(
      transferOwnershipAction(
        fd({
          team_id: "team-1",
          new_owner_user_id: "u-target",
          confirm_name: "Alex",
        }),
      ),
    ).rejects.toThrow(/shell account/);
  });
});

describe("updateMemberRoleAction", () => {
  beforeEach(reset);

  it("calls update_team_member_role when caller is owner promoting a member", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });

    await updateMemberRoleAction(
      fd({
        team_id: "team-1",
        member_id: "m-1",
        new_role: "admin",
      }),
    );

    expect(state.rpcCalls).toEqual([
      {
        name: "update_team_member_role",
        args: {
          p_team_id: "team-1",
          p_member_id: "m-1",
          p_new_role: "admin",
        },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/team-1");
  });

  it("admins can call the RPC (server-side asymmetry is enforced inside the RPC)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });

    await updateMemberRoleAction(
      fd({
        team_id: "team-1",
        member_id: "m-1",
        new_role: "member",
      }),
    );

    expect(state.rpcCalls).toHaveLength(1);
  });

  it("rejects callers with role='member' at the action layer (before RPC)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      updateMemberRoleAction(
        fd({
          team_id: "team-1",
          member_id: "m-1",
          new_role: "member",
        }),
      ),
    ).rejects.toThrow(/owner.*admin/i);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects an invalid role value (must be admin or member)", async () => {
    await expect(
      updateMemberRoleAction(
        fd({
          team_id: "team-1",
          member_id: "m-1",
          new_role: "owner",
        }),
      ),
    ).rejects.toThrow(/admin.*member/i);
    expect(state.rpcCalls).toHaveLength(0);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
  });

  it("rejects without team_id / member_id", async () => {
    await expect(
      updateMemberRoleAction(fd({ member_id: "m-1", new_role: "admin" })),
    ).rejects.toThrow(/team_id is required/);

    await expect(
      updateMemberRoleAction(fd({ team_id: "team-1", new_role: "admin" })),
    ).rejects.toThrow(/member_id is required/);

    expect(state.rpcCalls).toHaveLength(0);
  });

  it("propagates a Postgres error from the RPC (e.g. self-edit refusal)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.rpcError = {
      message: "update_team_member_role: you cannot change your own role",
    };

    await expect(
      updateMemberRoleAction(
        fd({
          team_id: "team-1",
          member_id: "m-1",
          new_role: "member",
        }),
      ),
    ).rejects.toThrow(/your own role/);
  });
});
