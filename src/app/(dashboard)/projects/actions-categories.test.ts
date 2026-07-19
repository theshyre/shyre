import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fourth harness for project actions — covers the category-management
 * exports plus visibility, projected-end-date normalization and the
 * projects_history reader, which the earlier suites scoped out.
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
const mockRequireTeamAdmin = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (...args: unknown[]) => mockValidateTeamAccess(...args),
  requireTeamAdmin: (...args: unknown[]) => mockRequireTeamAdmin(...args),
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

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const state: {
  user: { id: string } | null;
  rowQueues: Record<string, Result[]>;
  listQueues: Record<string, Result[]>;
  updates: { table: string; patch: Record<string, unknown>; filters: Filter[] }[];
  deletes: { table: string; filters: Filter[] }[];
  inserts: { table: string; rows: Record<string, unknown> }[];
  rpcResults: Record<string, unknown>;
} = {
  user: { id: fakeUserId },
  rowQueues: {},
  listQueues: {},
  updates: [],
  deletes: [],
  inserts: [],
  rpcResults: {},
};

function shiftRow(table: string): Result {
  return state.rowQueues[table]?.shift() ?? { data: null, error: null };
}

function mockSupabase() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: state.user } }),
    },
    rpc: (name: string) =>
      Promise.resolve({ data: state.rpcResults[name] ?? null, error: null }),
    from: (table: string) => {
      type Op =
        | { kind: "select" }
        | { kind: "update"; patch: Record<string, unknown> }
        | { kind: "delete" };
      const op: { current: Op | null; filters: Filter[] } = {
        current: null,
        filters: [],
      };
      const chain: Record<string, unknown> = {
        select: () => {
          op.current = { kind: "select" };
          return chain;
        },
        insert: (rows: Record<string, unknown>) => {
          state.inserts.push({ table, rows });
          const ic: Record<string, unknown> = {
            select: () => ic,
            single: () =>
              Promise.resolve({ data: { id: `${table}-new` }, error: null }),
            then: (
              onF: (v: Result) => unknown,
              onR?: (e: unknown) => unknown,
            ): Promise<unknown> =>
              Promise.resolve({ data: null, error: null }).then(onF, onR),
          };
          return ic;
        },
        update: (patch: Record<string, unknown>) => {
          op.current = { kind: "update", patch };
          return chain;
        },
        delete: () => {
          op.current = { kind: "delete" };
          return chain;
        },
        eq: (col: string, value: unknown) => {
          op.filters.push({ col, op: "eq", value });
          return chain;
        },
        in: (col: string, value: unknown) => {
          op.filters.push({ col, op: "in", value });
          return chain;
        },
        order: () => chain,
        range: () => chain,
        single: () => Promise.resolve(shiftRow(table)),
        maybeSingle: () => Promise.resolve(shiftRow(table)),
        then: (
          onF: (v: Result) => unknown,
          onR?: (e: unknown) => unknown,
        ): Promise<unknown> => {
          if (op.current?.kind === "update") {
            state.updates.push({
              table,
              patch: op.current.patch,
              filters: [...op.filters],
            });
            op.current = null;
            op.filters = [];
            return Promise.resolve({ data: null, error: null }).then(onF, onR);
          }
          if (op.current?.kind === "delete") {
            state.deletes.push({ table, filters: [...op.filters] });
            op.current = null;
            op.filters = [];
            return Promise.resolve({ data: null, error: null }).then(onF, onR);
          }
          const result =
            state.listQueues[table]?.shift() ?? { data: [], error: null };
          op.current = null;
          op.filters = [];
          return Promise.resolve(result).then(onF, onR);
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
  bulkSwitchCategorySetAction,
  deleteProjectCategoriesAction,
  getProjectHistoryAction,
  setProjectTimeEntriesVisibilityAction,
  updateProjectAction,
  upsertProjectCategoriesAction,
} from "./actions";

function reset(): void {
  state.user = { id: fakeUserId };
  state.rowQueues = {};
  state.listQueues = {};
  state.updates = [];
  state.deletes = [];
  state.inserts = [];
  state.rpcResults = {};
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({
    userId: fakeUserId,
    role: "owner",
  });
  mockRequireTeamAdmin.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("setProjectTimeEntriesVisibilityAction", () => {
  beforeEach(reset);

  it("writes a valid level for owner/admin", async () => {
    state.rowQueues["projects"] = [{ data: { team_id: "t-1" }, error: null }];
    await setProjectTimeEntriesVisibilityAction(
      fd({ id: "p-1", level: "read_all" }),
    );
    expect(state.updates).toEqual([
      {
        table: "projects",
        patch: { time_entries_visibility: "read_all" },
        filters: [{ col: "id", op: "eq", value: "p-1" }],
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t-1");
  });

  it("empty level clears the override (inherit team)", async () => {
    state.rowQueues["projects"] = [{ data: { team_id: "t-1" }, error: null }];
    await setProjectTimeEntriesVisibilityAction(fd({ id: "p-1", level: "" }));
    expect(state.updates[0]?.patch).toEqual({
      time_entries_visibility: null,
    });
  });

  it("rejects an unknown level before writing", async () => {
    state.rowQueues["projects"] = [{ data: { team_id: "t-1" }, error: null }];
    await expect(
      setProjectTimeEntriesVisibilityAction(
        fd({ id: "p-1", level: "everyone" }),
      ),
    ).rejects.toThrow(/Invalid level/);
    expect(state.updates).toHaveLength(0);
  });

  it("denies plain members", async () => {
    state.rowQueues["projects"] = [{ data: { team_id: "t-1" }, error: null }];
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      setProjectTimeEntriesVisibilityAction(
        fd({ id: "p-1", level: "read_all" }),
      ),
    ).rejects.toThrow(/Only owners and admins/);
  });

  it("errors on a missing project / missing id", async () => {
    state.rowQueues["projects"] = [{ data: null, error: null }];
    await expect(
      setProjectTimeEntriesVisibilityAction(fd({ id: "p-x", level: "read_all" })),
    ).rejects.toThrow(/Project not found/);
    await expect(
      setProjectTimeEntriesVisibilityAction(fd({ level: "read_all" })),
    ).rejects.toThrow(/Project id is required/);
  });
});

describe("upsertProjectCategoriesAction", () => {
  beforeEach(reset);

  const project = {
    id: "p-1",
    team_id: "t-1",
    category_set_id: "base-1",
  };

  it("creates the extension set on first save and syncs categories (insert/update/delete)", async () => {
    state.rowQueues["projects"] = [{ data: project, error: null }];
    // No existing project-scoped set yet.
    state.rowQueues["category_sets"] = [{ data: null, error: null }];
    // Base-set names for the overlap check, then current extension rows.
    state.listQueues["categories"] = [
      { data: [{ name: "Admin" }], error: null },
      { data: [{ id: "cat-old" }], error: null },
    ];

    await upsertProjectCategoriesAction(
      fd({
        project_id: "p-1",
        set_name: "AVDR extensions",
        categories: JSON.stringify([
          { id: "cat-keep", name: "Dev", color: "#123456", sort_order: 0 },
          { name: "Review", color: "#654321", sort_order: 1 },
        ]),
      }),
    );

    // New extension set created with the caller as author.
    expect(state.inserts[0]).toMatchObject({
      table: "category_sets",
      rows: {
        project_id: "p-1",
        team_id: null,
        name: "AVDR extensions",
        created_by: fakeUserId,
      },
    });
    // cat-old (not in payload) deleted; cat-keep updated; Review inserted.
    expect(state.deletes).toEqual([
      {
        table: "categories",
        filters: [{ col: "id", op: "in", value: ["cat-old"] }],
      },
    ]);
    expect(
      state.updates.find((u) => u.table === "categories")?.patch,
    ).toMatchObject({ name: "Dev", color: "#123456" });
    expect(
      state.inserts.find(
        (i) => i.table === "categories" && i.rows.name === "Review",
      )?.rows,
    ).toMatchObject({ category_set_id: "category_sets-new", sort_order: 1 });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/projects/p-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/time-entries");
  });

  it("refuses names that collide (case-insensitively) with the base set", async () => {
    state.rowQueues["projects"] = [{ data: project, error: null }];
    state.listQueues["categories"] = [
      { data: [{ name: "Admin" }], error: null },
    ];
    await expect(
      upsertProjectCategoriesAction(
        fd({
          project_id: "p-1",
          categories: JSON.stringify([
            { name: "  admin ", color: "#111111", sort_order: 0 },
          ]),
        }),
      ),
    ).rejects.toThrow(/already exist in the base set/);
    expect(state.inserts).toHaveLength(0);
  });

  it("repoints the base set when base_category_set_id differs, and renames an existing extension", async () => {
    state.rowQueues["projects"] = [{ data: project, error: null }];
    state.rowQueues["category_sets"] = [{ data: { id: "ext-1" }, error: null }];
    // New base's names (no overlap), then current extension rows.
    state.listQueues["categories"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    await upsertProjectCategoriesAction(
      fd({
        project_id: "p-1",
        base_category_set_id: "base-2",
        set_name: "Renamed",
        categories: JSON.stringify([
          { name: "Dev", color: "#123456", sort_order: 0 },
        ]),
      }),
    );
    expect(
      state.updates.find(
        (u) =>
          u.table === "projects" && u.patch.category_set_id === "base-2",
      ),
    ).toBeDefined();
    expect(
      state.updates.find(
        (u) => u.table === "category_sets" && u.patch.name === "Renamed",
      )?.filters,
    ).toEqual([{ col: "id", op: "eq", value: "ext-1" }]);
  });

  it("requires project_id and 404s a missing project", async () => {
    await expect(
      upsertProjectCategoriesAction(fd({ categories: "[]" })),
    ).rejects.toThrow(/project_id is required/);
    state.rowQueues["projects"] = [{ data: null, error: null }];
    await expect(
      upsertProjectCategoriesAction(fd({ project_id: "p-x", categories: "[]" })),
    ).rejects.toThrow(/Project not found/);
  });
});

describe("deleteProjectCategoriesAction", () => {
  beforeEach(reset);

  it("drops the extension set when one exists (categories cascade)", async () => {
    state.rowQueues["projects"] = [
      { data: { id: "p-1", team_id: "t-1" }, error: null },
    ];
    state.rowQueues["category_sets"] = [{ data: { id: "ext-1" }, error: null }];
    await deleteProjectCategoriesAction(fd({ project_id: "p-1" }));
    expect(state.deletes).toEqual([
      {
        table: "category_sets",
        filters: [{ col: "id", op: "eq", value: "ext-1" }],
      },
    ]);
  });

  it("no-ops (still revalidates) when there is no extension set", async () => {
    state.rowQueues["projects"] = [
      { data: { id: "p-1", team_id: "t-1" }, error: null },
    ];
    state.rowQueues["category_sets"] = [{ data: null, error: null }];
    await deleteProjectCategoriesAction(fd({ project_id: "p-1" }));
    expect(state.deletes).toHaveLength(0);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/projects/p-1");
  });
});

describe("bulkSwitchCategorySetAction", () => {
  beforeEach(reset);

  it("repoints every selected project to a visible set", async () => {
    state.rowQueues["category_sets"] = [{ data: { id: "set-1" }, error: null }];
    const f = new FormData();
    f.append("id", "p-1");
    f.append("id", "p-2");
    f.set("category_set_id", "set-1");
    await bulkSwitchCategorySetAction(f);
    expect(state.updates).toEqual([
      {
        table: "projects",
        patch: { category_set_id: "set-1" },
        filters: [{ col: "id", op: "in", value: ["p-1", "p-2"] }],
      },
    ]);
  });

  it("clearing (empty set id) skips the visibility check", async () => {
    const f = new FormData();
    f.append("id", "p-1");
    f.set("category_set_id", "");
    await bulkSwitchCategorySetAction(f);
    expect(state.updates[0]?.patch).toEqual({ category_set_id: null });
  });

  it("refuses a set the caller cannot see (RLS-invisible)", async () => {
    state.rowQueues["category_sets"] = [{ data: null, error: null }];
    const f = new FormData();
    f.append("id", "p-1");
    f.set("category_set_id", "set-foreign");
    await expect(bulkSwitchCategorySetAction(f)).rejects.toThrow(
      /isn't accessible/,
    );
    expect(state.updates).toHaveLength(0);
  });

  it("no-ops on an empty selection", async () => {
    await bulkSwitchCategorySetAction(new FormData());
    expect(state.updates).toHaveLength(0);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateProjectAction — projected_end_date normalization", () => {
  beforeEach(reset);

  it("accepts a well-formed date and empty-string clears it", async () => {
    await updateProjectAction(
      fd({ id: "p-1", name: "P", projected_end_date: "2026-09-30" }),
    );
    expect(state.updates[0]?.patch.projected_end_date).toBe("2026-09-30");

    reset();
    await updateProjectAction(
      fd({ id: "p-1", name: "P", projected_end_date: "" }),
    );
    expect(state.updates[0]?.patch.projected_end_date).toBeNull();
  });

  it("rejects a malformed date from a forged POST", async () => {
    await expect(
      updateProjectAction(
        fd({ id: "p-1", name: "P", projected_end_date: "next tuesday" }),
      ),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(state.updates).toHaveLength(0);
  });

  it("omitting the field leaves the stored date untouched", async () => {
    await updateProjectAction(fd({ id: "p-1", name: "P" }));
    expect(state.updates[0]?.patch).not.toHaveProperty("projected_end_date");
  });
});

describe("getProjectHistoryAction", () => {
  beforeEach(reset);

  const row = (id: string, actor: string | null): Record<string, unknown> => ({
    id,
    operation: "UPDATE",
    changed_at: "2026-07-01T10:00:00+00:00",
    changed_by_user_id: actor,
    previous_state: { name: "Old" },
  });

  it("throws Unauthorized without a session", async () => {
    state.user = null;
    await expect(getProjectHistoryAction("p-1")).rejects.toThrow(
      /Unauthorized/,
    );
  });

  it("maps rows, resolves actor names, and reports hasMore past the limit", async () => {
    state.listQueues["projects_history"] = [
      { data: [row("h-1", "u-a"), row("h-2", null)], error: null },
    ];
    state.listQueues["user_profiles"] = [
      { data: [{ user_id: "u-a", display_name: "Ana" }], error: null },
    ];
    const { history, hasMore } = await getProjectHistoryAction("p-1", {
      limit: 1,
    });
    expect(hasMore).toBe(true);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: "h-1",
      operation: "UPDATE",
      changedBy: { userId: "u-a", displayName: "Ana" },
      previousState: { name: "Old" },
    });
  });

  it("handles system rows (null actor) without a profile lookup", async () => {
    state.listQueues["projects_history"] = [
      { data: [row("h-1", null)], error: null },
    ];
    const { history, hasMore } = await getProjectHistoryAction("p-1");
    expect(hasMore).toBe(false);
    expect(history[0]?.changedBy).toEqual({ userId: null, displayName: null });
  });

  it("propagates a query failure", async () => {
    state.listQueues["projects_history"] = [
      { data: null, error: { message: "permission denied", code: "42501" } },
    ];
    await expect(getProjectHistoryAction("p-1")).rejects.toThrow();
  });
});
