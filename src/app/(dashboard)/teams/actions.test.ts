import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Action-layer tests for the teams surface — the create / leave /
 * delete triad. These touch RLS and the team-membership invariants:
 *
 *   - createTeamAction routes through the `create_team` RPC (the
 *     SECURITY DEFINER function that creates the team + the owner
 *     team_members row atomically; bypassing the RPC means RLS would
 *     stop you inserting into team_members for a team you're not yet
 *     a member of).
 *   - leaveTeamAction refuses when the actor is the sole owner.
 *   - deleteTeamAction is owner-only, typed-confirm, refuses to
 *     orphan the actor (last team), and CASCADEs an orphan business.
 *
 * The action uses `redirect` from next/navigation on success — we
 * mock it to throw a NEXT_REDIRECT-style error so the action exits
 * its happy path cleanly without trying to actually navigate.
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
  validateTeamAccess: (teamId: string) => mockValidateTeamAccess(teamId),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

// redirect() throws a NEXT_REDIRECT-shaped error so the action's
// `redirect("/teams")` call exits cleanly. Tests for the happy path
// can swallow this rejection.
const mockRedirect = vi.fn((path: string): never => {
  const err = new Error(`NEXT_REDIRECT ${path}`) as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};307;`;
  throw err;
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const state: {
  rpcCalls: RpcCall[];
  rpcError: { message: string } | null;
  /** Owners of the team — drives the sole-owner check in leaveTeam. */
  owners: Array<{ id: string }>;
  /** Count returned by .from("team_members").delete().eq().eq().count */
  leaveDeleteCount: number;
  /** Count returned by .from("team_members").select(..., {count}).eq(user_id) */
  ownedTeamsCount: number;
  /** Row returned by .from("teams").select("name, business_id").eq("id", _).single() */
  teamRow: { name: string; business_id: string | null } | null;
  /** Count returned by .from("teams").delete({count}).eq("id") */
  teamDeleteCount: number;
  /** Count returned by .from("teams").select(..., {count}).eq("business_id", _) */
  remainingTeamsForBusiness: number;
  /** Records every .from("businesses").delete().eq(...) */
  businessDeletes: Filter[][];
  dbError: { message: string } | null;
} = {
  rpcCalls: [],
  rpcError: null,
  owners: [],
  leaveDeleteCount: 1,
  ownedTeamsCount: 2,
  teamRow: null,
  teamDeleteCount: 1,
  remainingTeamsForBusiness: 0,
  businessDeletes: [],
  dbError: null,
};

function mockSupabase() {
  return {
    from: (table: string) => tableChain(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: state.rpcError });
    },
  };
}

function tableChain(table: string) {
  type Op =
    | { kind: "select"; count?: boolean; head?: boolean }
    | { kind: "delete"; count?: boolean }
    | { kind: "update" }
    | { kind: "insert" };
  const op: { current: Op | null; filters: Filter[]; selectedCols?: string } =
    {
      current: null,
      filters: [],
    };
  const chain: Record<string, unknown> = {
    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      op.current = {
        kind: "select",
        count: Boolean(opts?.count),
        head: Boolean(opts?.head),
      };
      op.selectedCols = cols;
      return chain;
    },
    insert() {
      op.current = { kind: "insert" };
      return chain;
    },
    update() {
      op.current = { kind: "update" };
      return chain;
    },
    delete(opts?: { count?: string }) {
      op.current = { kind: "delete", count: Boolean(opts?.count) };
      return chain;
    },
    eq(col: string, value: unknown) {
      op.filters.push({ col, op: "eq", value });
      return chain;
    },
    single() {
      // .single() on teams returns the teamRow fixture.
      if (table === "teams") {
        return Promise.resolve({
          data: state.teamRow,
          error: state.teamRow ? null : { message: "no rows" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(
      resolve: (v: {
        data: unknown;
        error: unknown;
        count?: number;
      }) => void,
    ) {
      if (op.current?.kind === "select") {
        if (table === "team_members") {
          const usedUserIdFilter = op.filters.some(
            (f) => f.col === "user_id",
          );
          if (usedUserIdFilter && op.current.count) {
            resolve({
              data: null,
              error: null,
              count: state.ownedTeamsCount,
            });
            return;
          }
          // .select(...).eq("team_id", _).eq("role", "owner") — list of owners
          if (op.filters.some((f) => f.col === "role")) {
            resolve({ data: state.owners, error: null });
            return;
          }
        }
        if (table === "teams" && op.current.count) {
          resolve({
            data: null,
            error: null,
            count: state.remainingTeamsForBusiness,
          });
          return;
        }
      }
      if (op.current?.kind === "delete") {
        if (table === "team_members") {
          resolve({
            data: null,
            error: state.dbError,
            count: state.leaveDeleteCount,
          });
          return;
        }
        if (table === "teams") {
          resolve({
            data: null,
            error: state.dbError,
            count: state.teamDeleteCount,
          });
          return;
        }
        if (table === "businesses") {
          state.businessDeletes.push([...op.filters]);
          resolve({ data: null, error: null });
          return;
        }
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
  createTeamAction,
  deleteTeamAction,
  leaveTeamAction,
} from "./actions";

function reset(): void {
  state.rpcCalls = [];
  state.rpcError = null;
  state.owners = [];
  state.leaveDeleteCount = 1;
  state.ownedTeamsCount = 2;
  state.teamRow = null;
  state.teamDeleteCount = 1;
  state.remainingTeamsForBusiness = 0;
  state.businessDeletes = [];
  state.dbError = null;
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
  mockRedirect.mockClear();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createTeamAction", () => {
  beforeEach(reset);

  it("routes through the SECURITY DEFINER create_team RPC with the trimmed name", async () => {
    try {
      await createTeamAction(fd({ team_name: "  Acme Co  " }));
    } catch {
      // The action redirects on success; our mockRedirect throws.
    }
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]).toEqual({
      name: "create_team",
      args: { team_name: "Acme Co" },
    });
  });

  it("rejects empty / whitespace-only names without calling the RPC", async () => {
    await expect(
      createTeamAction(fd({ team_name: "   " })),
    ).rejects.toThrow(/Team name is required/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects missing team_name", async () => {
    await expect(createTeamAction(fd({}))).rejects.toThrow(/required/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("propagates RPC errors (e.g. RLS rejection or unique-name violation)", async () => {
    state.rpcError = { message: "duplicate key value on teams_name" };
    await expect(
      createTeamAction(fd({ team_name: "Acme" })),
    ).rejects.toThrow(/duplicate key/);
  });

  it("redirects to /teams on success", async () => {
    await expect(
      createTeamAction(fd({ team_name: "Acme" })),
    ).rejects.toThrow(/NEXT_REDIRECT.*\/teams/);
    expect(mockRedirect).toHaveBeenCalledWith("/teams");
  });
});

describe("leaveTeamAction", () => {
  beforeEach(reset);

  it("a non-owner can leave (no owner-count check fires); membership row is deleted scoped to (team_id, user_id)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    state.leaveDeleteCount = 1;
    await expect(leaveTeamAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(mockRedirect).toHaveBeenCalledWith("/teams");
  });

  it("sole-owner cannot leave — must transfer first", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.owners = [{ id: "tm-only-one" }];
    await expect(
      leaveTeamAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/Transfer ownership.*sole owner/);
  });

  it("co-owner CAN leave (more than one owner exists)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.owners = [{ id: "tm-a" }, { id: "tm-b" }];
    await expect(leaveTeamAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
  });

  it("count=0 on the delete → 'Leave failed' (RLS silently returned zero rows)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    state.leaveDeleteCount = 0;
    await expect(
      leaveTeamAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/Leave failed/);
  });

  it("propagates DB errors verbatim", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    state.dbError = { message: "FK violation on team_members.deleted_at" };
    await expect(
      leaveTeamAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/FK violation/);
  });
});

describe("deleteTeamAction", () => {
  beforeEach(reset);

  it("rejects non-owners (admin not enough)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    state.teamRow = { name: "Acme", business_id: null };
    await expect(
      deleteTeamAction(fd({ team_id: "t-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/Only the owner/);
  });

  it("refuses to delete the actor's last team (would orphan their membership graph)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.ownedTeamsCount = 1;
    state.teamRow = { name: "Acme", business_id: null };
    await expect(
      deleteTeamAction(fd({ team_id: "t-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/last team/);
  });

  it("typed-confirm must match the team name (case-sensitive)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.teamRow = { name: "Acme", business_id: null };
    await expect(
      deleteTeamAction(fd({ team_id: "t-1", confirm_name: "acme" })),
    ).rejects.toThrow(/does not match/);
  });

  it("delete count=0 → 'Delete failed' (RLS silently returned zero rows)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.teamRow = { name: "Acme", business_id: null };
    state.teamDeleteCount = 0;
    await expect(
      deleteTeamAction(fd({ team_id: "t-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/Delete failed/);
  });

  it("orphan business is cleaned up when the deleted team was the last one under it", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.teamRow = { name: "Acme", business_id: "biz-1" };
    state.remainingTeamsForBusiness = 0;
    await expect(
      deleteTeamAction(fd({ team_id: "t-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    // businesses.delete fired with eq("id", "biz-1").
    expect(state.businessDeletes).toHaveLength(1);
    expect(state.businessDeletes[0]).toContainEqual({
      col: "id",
      op: "eq",
      value: "biz-1",
    });
  });

  it("orphan business is NOT cleaned up when other teams still reference it", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.teamRow = { name: "Acme", business_id: "biz-1" };
    state.remainingTeamsForBusiness = 1;
    await expect(
      deleteTeamAction(fd({ team_id: "t-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.businessDeletes).toHaveLength(0);
  });

  it("redirects to /teams + revalidates /teams and /business on success", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.teamRow = { name: "Acme", business_id: null };
    await expect(
      deleteTeamAction(fd({ team_id: "t-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
    expect(mockRedirect).toHaveBeenCalledWith("/teams");
  });
});
