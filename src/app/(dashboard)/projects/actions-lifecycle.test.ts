import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Coverage for the lifecycle close-out actions added with project
 * lifecycle dates: closeOut / reopen / bulkClose / bulkReopen and the
 * getProjectUnbilledSummary read. Focus is on the admin gate and the
 * bulk-close eligibility filtering (terminal / non-admin team /
 * parent-with-open-children), which is the load-bearing new logic.
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
    try {
      await fn(formData, { supabase: mockSupabase(), userId: fakeUserId });
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: { message: e instanceof Error ? e.message : "err" },
      };
    }
  },
}));

const mockRequireTeamAdmin = vi.fn();
const mockValidateTeamAccess = vi.fn();
vi.mock("@/lib/team-context", () => ({
  requireTeamAdmin: (teamId: string) => mockRequireTeamAdmin(teamId),
  validateTeamAccess: (teamId: string) => mockValidateTeamAccess(teamId),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

interface SelectResult {
  data: unknown;
  error: unknown;
}

const state: {
  // keyed by `${table}:${columns}`
  selects: Record<string, SelectResult>;
  updates: Array<{
    table: string;
    patch: unknown;
    op: string;
    col: string;
    value: unknown;
  }>;
  user: { id: string } | null;
} = { selects: {}, updates: [], user: { id: fakeUserId } };

function resolve(table: string, columns: string): SelectResult {
  return state.selects[`${table}:${columns}`] ?? { data: [], error: null };
}

function mockSupabase(): unknown {
  function builder(table: string) {
    let columns = "";
    const b: Record<string, unknown> = {
      select(cols: string) {
        columns = cols;
        return b;
      },
      eq() {
        return b;
      },
      in() {
        return b;
      },
      is() {
        return b;
      },
      not() {
        return b;
      },
      single() {
        return Promise.resolve(resolve(table, columns));
      },
      maybeSingle() {
        return Promise.resolve(resolve(table, columns));
      },
      update(patch: unknown) {
        return {
          eq: (col: string, value: unknown) => {
            state.updates.push({ table, patch, op: "eq", col, value });
            return Promise.resolve({ error: null });
          },
          in: (col: string, value: unknown) => {
            state.updates.push({ table, patch, op: "in", col, value });
            return Promise.resolve({ error: null });
          },
        };
      },
      then(onF: (r: SelectResult) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(resolve(table, columns)).then(onF, onR);
      },
    };
    return b;
  }
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: state.user } }) },
    from: (table: string) => builder(table),
  };
}

import {
  closeOutProjectAction,
  reopenProjectAction,
  bulkCloseProjectsAction,
  bulkReopenProjectsAction,
  getProjectUnbilledSummaryAction,
} from "./actions";

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.selects = {};
  state.updates = [];
  state.user = { id: fakeUserId };
  mockRequireTeamAdmin.mockReset();
  mockValidateTeamAccess.mockReset();
});

describe("closeOutProjectAction", () => {
  it("closes a live project to 'completed' when caller is an admin", async () => {
    state.selects["projects:team_id, status"] = {
      data: { team_id: "t-1", status: "active" },
      error: null,
    };
    mockRequireTeamAdmin.mockResolvedValue({ userId: fakeUserId, role: "admin" });

    await closeOutProjectAction(fd([["id", "p-1"]]));

    expect(mockRequireTeamAdmin).toHaveBeenCalledWith("t-1");
    expect(state.updates).toEqual([
      { table: "projects", patch: { status: "completed" }, op: "eq", col: "id", value: "p-1" },
    ]);
  });

  it("does not update when the caller is not an admin (gate throws)", async () => {
    state.selects["projects:team_id, status"] = {
      data: { team_id: "t-1", status: "active" },
      error: null,
    };
    mockRequireTeamAdmin.mockRejectedValue(new Error("Only team owners and admins…"));

    await closeOutProjectAction(fd([["id", "p-1"]]));

    expect(state.updates).toHaveLength(0);
  });

  it("is a no-op when the project is already completed", async () => {
    state.selects["projects:team_id, status"] = {
      data: { team_id: "t-1", status: "completed" },
      error: null,
    };
    mockRequireTeamAdmin.mockResolvedValue({ userId: fakeUserId, role: "owner" });

    await closeOutProjectAction(fd([["id", "p-1"]]));

    expect(state.updates).toHaveLength(0);
  });
});

describe("reopenProjectAction", () => {
  it("sets a closed project back to 'active' for an admin", async () => {
    state.selects["projects:team_id"] = {
      data: { team_id: "t-1" },
      error: null,
    };
    mockRequireTeamAdmin.mockResolvedValue({ userId: fakeUserId, role: "admin" });

    await reopenProjectAction(fd([["id", "p-1"]]));

    expect(state.updates).toEqual([
      { table: "projects", patch: { status: "active" }, op: "eq", col: "id", value: "p-1" },
    ]);
  });
});

describe("bulkCloseProjectsAction", () => {
  it("closes only eligible projects: admin team, not terminal, no open children", async () => {
    state.selects["projects:id, team_id, status"] = {
      data: [
        { id: "p-live", team_id: "t-admin", status: "active" },
        { id: "p-done", team_id: "t-admin", status: "completed" }, // already terminal → skip
        { id: "p-foreign", team_id: "t-member", status: "active" }, // not admin → skip
        { id: "p-parent", team_id: "t-admin", status: "active" }, // has open child → skip
      ],
      error: null,
    };
    state.selects["projects:parent_project_id, status"] = {
      data: [{ parent_project_id: "p-parent", status: "active" }],
      error: null,
    };
    mockValidateTeamAccess.mockImplementation((teamId: string) =>
      Promise.resolve({
        userId: fakeUserId,
        role: teamId === "t-admin" ? "admin" : "member",
      }),
    );

    await bulkCloseProjectsAction(
      fd([
        ["id", "p-live"],
        ["id", "p-done"],
        ["id", "p-foreign"],
        ["id", "p-parent"],
      ]),
    );

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      patch: { status: "completed" },
      op: "in",
      value: ["p-live"],
    });
  });

  it("no-ops on empty selection", async () => {
    await bulkCloseProjectsAction(new FormData());
    expect(state.updates).toHaveLength(0);
  });
});

describe("bulkReopenProjectsAction", () => {
  it("reopens only projects in teams the caller administers", async () => {
    state.selects["projects:id, team_id"] = {
      data: [
        { id: "p-1", team_id: "t-admin" },
        { id: "p-2", team_id: "t-member" },
      ],
      error: null,
    };
    mockValidateTeamAccess.mockImplementation((teamId: string) =>
      Promise.resolve({
        userId: fakeUserId,
        role: teamId === "t-admin" ? "owner" : "member",
      }),
    );

    await bulkReopenProjectsAction(fd([["id", "p-1"], ["id", "p-2"]]));

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      patch: { status: "active" },
      value: ["p-1"],
    });
  });
});

describe("getProjectUnbilledSummaryAction", () => {
  it("sums unbilled billable minutes and counts time + expenses", async () => {
    state.selects["time_entries:duration_min"] = {
      data: [{ duration_min: 90 }, { duration_min: 30 }, { duration_min: null }],
      error: null,
    };
    state.selects["expenses:id"] = {
      data: [{ id: "e-1" }, { id: "e-2" }],
      error: null,
    };

    const summary = await getProjectUnbilledSummaryAction("p-1");

    expect(summary).toEqual({
      timeMinutes: 120,
      timeCount: 3,
      expenseCount: 2,
    });
  });

  it("throws when unauthenticated", async () => {
    state.user = null;
    await expect(getProjectUnbilledSummaryAction("p-1")).rejects.toThrow(
      /Unauthorized/,
    );
  });
});
