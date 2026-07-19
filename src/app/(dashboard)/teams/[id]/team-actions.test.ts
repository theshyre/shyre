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
  rpcError: { message: string; code?: string } | null;
  /** What `.from("user_profiles").select("display_name").eq("user_id",
   *  uid).maybeSingle()` returns when transferOwnershipAction looks
   *  up the target's name for the typed-confirm comparison. */
  targetProfile: { display_name: string | null } | null;
  /** team_members role lookup (.single) inside removeMemberAction. */
  memberRow: { role: string } | null;
  memberError: { message: string; code?: string } | null;
  /** team_members team_id lookup (.single) inside setMemberRateAction. */
  membershipRow: { team_id: string } | null;
  /** can_set_member_rate RPC answer. */
  canSetMemberRate: boolean;
  inserts: { table: string; rows: unknown }[];
  updates: {
    table: string;
    patch: Record<string, unknown>;
    where: [string, unknown][];
  }[];
  deletes: { table: string; where: [string, unknown][] }[];
} = {
  rpcCalls: [],
  rpcError: null,
  targetProfile: null,
  memberRow: null,
  memberError: null,
  membershipRow: null,
  canSetMemberRate: true,
  inserts: [],
  updates: [],
  deletes: [],
};

function mockSupabase() {
  return {
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      if (name === "can_set_member_rate") {
        return Promise.resolve({ data: state.canSetMemberRate, error: null });
      }
      return Promise.resolve({ data: null, error: state.rpcError });
    },
    from: (table: string) => ({
      select: (cols?: string) => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.targetProfile }),
          single: () => {
            if (table === "team_members" && cols === "role") {
              return Promise.resolve({
                data: state.memberRow,
                error: state.memberError,
              });
            }
            if (table === "team_members" && cols === "team_id") {
              return Promise.resolve({
                data: state.membershipRow,
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      insert: (rows: unknown) => {
        state.inserts.push({ table, rows });
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          state.updates.push({ table, patch, where: [[col, val]] });
          return Promise.resolve({ data: null, error: null });
        },
      }),
      delete: () => ({
        eq: (col: string, val: unknown) => {
          state.deletes.push({ table, where: [[col, val]] });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  updateTeamNameAction,
  transferOwnershipAction,
  updateMemberRoleAction,
  setMemberRateAction,
} from "./team-actions";

function reset(): void {
  state.rpcCalls = [];
  state.rpcError = null;
  state.targetProfile = null;
  state.memberRow = { role: "member" };
  state.memberError = null;
  state.membershipRow = { team_id: "team-1" };
  state.canSetMemberRate = true;
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
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

  // SAL-052: the role-transition RPCs raise deliberate refusals with
  // ERRCODE 22023 — those must keep reaching the client verbatim,
  // while raw Postgres text (constraint names) must not.
  it("forwards the RPC's 22023 refusal verbatim through the sanctioned CONFLICT path", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.rpcError = {
      message: "update_team_member_role: member does not belong to this team",
      code: "22023",
    };
    try {
      await updateMemberRoleAction(
        fd({ team_id: "team-1", member_id: "m-1", new_role: "member" }),
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      const safe = (err as import("@/lib/errors").AppError).toUserSafe();
      expect(safe.message).toBe(
        "update_team_member_role: member does not belong to this team",
      );
    }
  });

  it("sanitizes raw Postgres text from the RPC — client shape carries only the i18n key", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.rpcError = {
      message: 'duplicate key value violates unique constraint "team_members_pkey"',
      code: "23505",
    };
    try {
      await updateMemberRoleAction(
        fd({ team_id: "team-1", member_id: "m-1", new_role: "member" }),
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      const safe = (err as import("@/lib/errors").AppError).toUserSafe();
      expect(safe.userMessageKey).toBe("errors.conflict");
      expect(safe.message).toBeUndefined();
      expect(JSON.stringify(safe)).not.toContain("team_members_pkey");
    }
  });
});

describe("inviteMemberAction", () => {
  beforeEach(reset);

  it("inserts a team_invites row with the caller as inviter", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    await inviteMemberAction(
      fd({ team_id: "team-1", email: "new@acme.test", role: "admin" }),
    );
    expect(state.inserts).toEqual([
      {
        table: "team_invites",
        rows: {
          team_id: "team-1",
          email: "new@acme.test",
          role: "admin",
          invited_by: fakeUserId,
        },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/team-1");
  });

  it("defaults a missing role to member", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await inviteMemberAction(fd({ team_id: "team-1", email: "n@a.io" }));
    expect(state.inserts[0]?.rows).toMatchObject({ role: "member" });
  });

  it("rejects an attempt to invite an owner (role smuggling)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await expect(
      inviteMemberAction(
        fd({ team_id: "team-1", email: "x@a.io", role: "owner" }),
      ),
    ).rejects.toThrow(/Invalid role/);
    expect(state.inserts).toHaveLength(0);
  });

  it("denies plain members before any insert", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      inviteMemberAction(fd({ team_id: "team-1", email: "x@a.io" })),
    ).rejects.toThrow(/Only owners and admins/);
    expect(state.inserts).toHaveLength(0);
  });
});

describe("removeMemberAction", () => {
  beforeEach(() => {
    reset();
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
  });

  it("deletes a plain member's membership row", async () => {
    await removeMemberAction(
      fd({ team_id: "team-1", member_id: "m-2", member_user_id: "u-other" }),
    );
    expect(state.deletes).toEqual([
      { table: "team_members", where: [["id", "m-2"]] },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/team-1");
  });

  it("refuses to remove yourself", async () => {
    await expect(
      removeMemberAction(
        fd({ team_id: "team-1", member_id: "m-1", member_user_id: fakeUserId }),
      ),
    ).rejects.toThrow(/cannot remove yourself/);
    expect(state.deletes).toHaveLength(0);
  });

  it("refuses to remove the team owner", async () => {
    state.memberRow = { role: "owner" };
    await expect(
      removeMemberAction(
        fd({
          team_id: "team-1",
          member_id: "m-owner",
          member_user_id: "u-owner",
        }),
      ),
    ).rejects.toThrow(/Cannot remove the team owner/);
    expect(state.deletes).toHaveLength(0);
  });

  it("fails closed when the role lookup errors — the delete must NOT proceed (regression: unchecked .single())", async () => {
    state.memberRow = null;
    state.memberError = { message: "permission denied", code: "42501" };
    await expect(
      removeMemberAction(
        fd({ team_id: "team-1", member_id: "m-2", member_user_id: "u-other" }),
      ),
    ).rejects.toThrow();
    expect(state.deletes).toHaveLength(0);
  });

  it("denies plain members", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      removeMemberAction(
        fd({ team_id: "team-1", member_id: "m-2", member_user_id: "u-other" }),
      ),
    ).rejects.toThrow(/Only owners and admins/);
    expect(state.deletes).toHaveLength(0);
  });
});

describe("revokeInviteAction", () => {
  beforeEach(reset);

  it("deletes the invite for owner/admin callers", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    await revokeInviteAction(fd({ team_id: "team-1", invite_id: "i-3" }));
    expect(state.deletes).toEqual([
      { table: "team_invites", where: [["id", "i-3"]] },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/team-1");
  });

  it("denies plain members without deleting", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      revokeInviteAction(fd({ team_id: "team-1", invite_id: "i-3" })),
    ).rejects.toThrow(/Only owners and admins/);
    expect(state.deletes).toHaveLength(0);
  });
});

describe("updateTeamNameAction", () => {
  beforeEach(reset);

  it("admins can rename the team", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    await updateTeamNameAction(
      fd({ team_id: "team-1", team_name: "New Name" }),
    );
    expect(state.updates).toEqual([
      {
        table: "teams",
        patch: { name: "New Name" },
        where: [["id", "team-1"]],
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/team-1");
  });

  it("plain members cannot rename", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      updateTeamNameAction(fd({ team_id: "team-1", team_name: "Nope" })),
    ).rejects.toThrow(/owner or admin/);
    expect(state.updates).toHaveLength(0);
  });
});

describe("setMemberRateAction", () => {
  beforeEach(reset);

  it("writes the parsed rate when can_set_member_rate allows it", async () => {
    await setMemberRateAction(
      fd({ membership_id: "m-2", default_rate: "182.50" }),
    );
    expect(state.updates).toEqual([
      {
        table: "team_members",
        patch: { default_rate: 182.5 },
        where: [["id", "m-2"]],
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/team-1");
  });

  it("clears the rate when default_rate is blank", async () => {
    await setMemberRateAction(fd({ membership_id: "m-2", default_rate: "" }));
    expect(state.updates[0]?.patch).toEqual({ default_rate: null });
  });

  it("rejects a non-numeric rate instead of writing NaN (regression)", async () => {
    await expect(
      setMemberRateAction(fd({ membership_id: "m-2", default_rate: "abc" })),
    ).rejects.toThrow(/not a valid rate/);
    expect(state.updates).toHaveLength(0);
  });

  it("refuses when the permission RPC denies, without writing", async () => {
    state.canSetMemberRate = false;
    await expect(
      setMemberRateAction(fd({ membership_id: "m-2", default_rate: "100" })),
    ).rejects.toThrow(/Not authorized/);
    expect(state.updates).toHaveLength(0);
  });

  it("requires membership_id before the permission check", async () => {
    await expect(
      setMemberRateAction(fd({ default_rate: "100" })),
    ).rejects.toThrow(/membership_id is required/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("still writes but skips revalidation when the team lookup returns nothing", async () => {
    state.membershipRow = null;
    await setMemberRateAction(
      fd({ membership_id: "m-2", default_rate: "100" }),
    );
    expect(state.updates).toHaveLength(1);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
