import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Action-layer tests for security-groups — the ACL grouping
 * primitive used by the customer-permission grants. The four
 * actions all gate on owner|admin role; the add/remove member
 * actions defer to the group's team_id (not a form-supplied
 * value) so a member can't forge their way into another team's
 * group by lying in the form.
 *
 * Coverage shape mirrors the other action test suites:
 *   - happy-path INSERT/DELETE shape
 *   - role-gate rejection on plain member
 *   - missing required field rejection
 *   - cross-team scoping defense (delete uses team_id eq filter)
 *   - group-not-found rejection on add/remove
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

const mockValidateTeamAccess = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (...args: unknown[]) =>
    mockValidateTeamAccess(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

const state: {
  inserts: { table: string; rows: unknown }[];
  deletes: { table: string; filters: Filter[]; count: number | null }[];
  /** What `.from("security_groups").select("team_id").eq("id", X).single()`
   *  returns when the add/remove member actions look up the group's
   *  team. `null` simulates "group not found". */
  groupLookup: { team_id: string } | null;
  /** Forced error for the next insert/delete call. */
  dbError: { message: string } | null;
  /** Count returned by delete chains that ask for it. */
  deleteCount: number;
} = {
  inserts: [],
  deletes: [],
  groupLookup: null,
  dbError: null,
  deleteCount: 1,
};

function mockSupabase() {
  return {
    from: (table: string) => tableChain(table),
  };
}

function tableChain(table: string) {
  type Op =
    | { kind: "insert"; rows: unknown }
    | { kind: "delete"; askedCount: boolean }
    | { kind: "select" };
  const op: { current: Op | null; filters: Filter[] } = {
    current: null,
    filters: [],
  };
  const chain: Record<string, unknown> = {
    select() {
      op.current = { kind: "select" };
      return chain;
    },
    insert(rows: unknown) {
      state.inserts.push({ table, rows });
      const insertChain: Record<string, unknown> = {
        then: (resolve: (v: { data: null; error: unknown }) => void) => {
          resolve({ data: null, error: state.dbError });
        },
      };
      return insertChain;
    },
    delete(opts?: { count?: string }) {
      op.current = { kind: "delete", askedCount: Boolean(opts?.count) };
      return chain;
    },
    eq(col: string, value: unknown) {
      op.filters.push({ col, op: "eq", value });
      return chain;
    },
    single() {
      // Used by addGroupMemberAction + removeGroupMemberAction to
      // look up the group's team_id before role-gating.
      return Promise.resolve({
        data: state.groupLookup,
        error: state.groupLookup ? null : { message: "no rows" },
      });
    },
    then(
      resolve: (v: {
        data: unknown;
        error: unknown;
        count?: number;
      }) => void,
    ) {
      if (op.current?.kind === "delete") {
        state.deletes.push({
          table,
          filters: [...op.filters],
          count: op.current.askedCount ? state.deleteCount : null,
        });
        resolve({
          data: null,
          error: state.dbError,
          count: op.current.askedCount ? state.deleteCount : undefined,
        });
        return;
      }
      resolve({ data: null, error: state.dbError });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  addGroupMemberAction,
  createGroupAction,
  deleteGroupAction,
  removeGroupMemberAction,
} from "./actions";

function reset(): void {
  state.inserts = [];
  state.deletes = [];
  state.groupLookup = null;
  state.dbError = null;
  state.deleteCount = 1;
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createGroupAction", () => {
  beforeEach(reset);

  it("inserts a security_groups row with team + creator stamps", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await createGroupAction(
      fd({ team_id: "t-1", name: "Auditors", description: "External" }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe("security_groups");
    expect(state.inserts[0]?.rows).toEqual({
      team_id: "t-1",
      name: "Auditors",
      description: "External",
      created_by: fakeUserId,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/security-groups");
  });

  it("admin can create (not only owner)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    await createGroupAction(fd({ team_id: "t-1", name: "Auditors" }));
    expect(state.inserts).toHaveLength(1);
  });

  it("rejects plain member with a friendly message; no insert", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "member" });
    await expect(
      createGroupAction(fd({ team_id: "t-1", name: "Auditors" })),
    ).rejects.toThrow(/owners and admins/);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects empty name (whitespace trimmed)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await expect(
      createGroupAction(fd({ team_id: "t-1", name: "   " })),
    ).rejects.toThrow(/Group name is required/);
    expect(state.inserts).toHaveLength(0);
  });

  it("trims whitespace from the name (defensive vs ' Auditors ')", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await createGroupAction(fd({ team_id: "t-1", name: "  Auditors  " }));
    expect((state.inserts[0]?.rows as { name: string }).name).toBe("Auditors");
  });

  it("normalizes empty description to null", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await createGroupAction(fd({ team_id: "t-1", name: "Auditors", description: "" }));
    expect((state.inserts[0]?.rows as { description: string | null }).description).toBeNull();
  });

  it("propagates DB errors via assertSupabaseOk", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.dbError = { message: "unique violation on (team_id, name)" };
    await expect(
      createGroupAction(fd({ team_id: "t-1", name: "Dup" })),
    ).rejects.toThrow(/unique violation/);
  });
});

describe("deleteGroupAction", () => {
  beforeEach(reset);

  it("deletes by id AND team_id (cross-team scoping defense)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await deleteGroupAction(fd({ group_id: "g-1", team_id: "t-1" }));
    expect(state.deletes).toHaveLength(1);
    expect(state.deletes[0]?.table).toBe("security_groups");
    expect(state.deletes[0]?.filters).toContainEqual({
      col: "id",
      op: "eq",
      value: "g-1",
    });
    expect(state.deletes[0]?.filters).toContainEqual({
      col: "team_id",
      op: "eq",
      value: "t-1",
    });
  });

  it("admin can delete (not only owner)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    await deleteGroupAction(fd({ group_id: "g-1", team_id: "t-1" }));
    expect(state.deletes).toHaveLength(1);
  });

  it("rejects plain member; no delete", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "member" });
    await expect(
      deleteGroupAction(fd({ group_id: "g-1", team_id: "t-1" })),
    ).rejects.toThrow(/owners and admins/);
    expect(state.deletes).toHaveLength(0);
  });

  it("count=0 → 'Group not found or permission denied' (no silent no-op)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.deleteCount = 0;
    await expect(
      deleteGroupAction(fd({ group_id: "g-1", team_id: "t-1" })),
    ).rejects.toThrow(/not found|permission denied/i);
  });

  it("revalidates /security-groups on success", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await deleteGroupAction(fd({ group_id: "g-1", team_id: "t-1" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/security-groups");
  });
});

describe("addGroupMemberAction", () => {
  beforeEach(reset);

  it("derives team_id from the group's row (not the form) and inserts the member", async () => {
    state.groupLookup = { team_id: "t-1" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await addGroupMemberAction(
      fd({ group_id: "g-1", user_id: "u-newbie" }),
    );
    // validateTeamAccess MUST be called with the team derived from
    // the group lookup, not anything the caller could forge.
    expect(mockValidateTeamAccess).toHaveBeenCalledWith("t-1");
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe("security_group_members");
    expect(state.inserts[0]?.rows).toEqual({
      group_id: "g-1",
      user_id: "u-newbie",
      added_by: fakeUserId,
    });
  });

  it("rejects when the group does not exist (no insert)", async () => {
    state.groupLookup = null;
    await expect(
      addGroupMemberAction(fd({ group_id: "g-nope", user_id: "u-newbie" })),
    ).rejects.toThrow(/Group not found/);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects plain member of the group's team", async () => {
    state.groupLookup = { team_id: "t-1" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "member" });
    await expect(
      addGroupMemberAction(fd({ group_id: "g-1", user_id: "u-newbie" })),
    ).rejects.toThrow(/owners and admins/);
    expect(state.inserts).toHaveLength(0);
  });

  it("admin can add (not only owner)", async () => {
    state.groupLookup = { team_id: "t-1" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    await addGroupMemberAction(
      fd({ group_id: "g-1", user_id: "u-newbie" }),
    );
    expect(state.inserts).toHaveLength(1);
  });

  it("propagates DB errors (e.g. duplicate membership) via assertSupabaseOk", async () => {
    state.groupLookup = { team_id: "t-1" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.dbError = { message: "unique violation on (group_id, user_id)" };
    await expect(
      addGroupMemberAction(fd({ group_id: "g-1", user_id: "u-newbie" })),
    ).rejects.toThrow(/unique violation/);
  });
});

describe("removeGroupMemberAction", () => {
  beforeEach(reset);

  it("derives team_id from the group's row before role-gating; deletes by composite key", async () => {
    state.groupLookup = { team_id: "t-1" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await removeGroupMemberAction(
      fd({ group_id: "g-1", user_id: "u-ex" }),
    );
    expect(mockValidateTeamAccess).toHaveBeenCalledWith("t-1");
    expect(state.deletes).toHaveLength(1);
    expect(state.deletes[0]?.table).toBe("security_group_members");
    expect(state.deletes[0]?.filters).toContainEqual({
      col: "group_id",
      op: "eq",
      value: "g-1",
    });
    expect(state.deletes[0]?.filters).toContainEqual({
      col: "user_id",
      op: "eq",
      value: "u-ex",
    });
  });

  it("rejects when the group does not exist", async () => {
    state.groupLookup = null;
    await expect(
      removeGroupMemberAction(
        fd({ group_id: "g-nope", user_id: "u-ex" }),
      ),
    ).rejects.toThrow(/Group not found/);
    expect(state.deletes).toHaveLength(0);
  });

  it("rejects plain member", async () => {
    state.groupLookup = { team_id: "t-1" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "member" });
    await expect(
      removeGroupMemberAction(fd({ group_id: "g-1", user_id: "u-ex" })),
    ).rejects.toThrow(/owners and admins/);
    expect(state.deletes).toHaveLength(0);
  });

  it("propagates DB errors verbatim", async () => {
    state.groupLookup = { team_id: "t-1" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.dbError = { message: "RLS violation" };
    await expect(
      removeGroupMemberAction(fd({ group_id: "g-1", user_id: "u-ex" })),
    ).rejects.toThrow(/RLS violation/);
  });

  it("revalidates /security-groups on success", async () => {
    state.groupLookup = { team_id: "t-1" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await removeGroupMemberAction(
      fd({ group_id: "g-1", user_id: "u-ex" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/security-groups");
  });
});
