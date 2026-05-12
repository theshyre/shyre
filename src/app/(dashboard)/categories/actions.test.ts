import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * categories/actions.ts has 7 actions across two grain levels:
 * category_sets (the container) and categories (the rows). All
 * validate team access; category_set ops scope by team_id; category
 * ops trust the set's RLS to enforce ownership.
 *
 * Coverage focus:
 *   - createCategorySet: required-name + creator stamp
 *   - cloneCategorySet: copies the source set + its categories
 *   - updateCategorySet / deleteCategorySet: cross-team scoping
 *   - createCategory / updateCategory: color defaulting + sort_order parsing
 *   - deleteCategory: scoped by id
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

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

const state: {
  inserts: { table: string; rows: unknown }[];
  updates: { table: string; patch: unknown; filters: Filter[] }[];
  deletes: { table: string; filters: Filter[] }[];
  /** What .from("category_sets").select(...).eq("id", source_id).single() returns */
  sourceSet: { id: string; name: string; description: string | null } | null;
  /** What .from("categories").select(...).eq("category_set_id", source_id) returns */
  sourceCats: Array<{
    name: string;
    color: string;
    sort_order: number;
  }>;
  /** The id returned by the insert(...).select("id").single() on the new clone */
  newSetId: string;
} = {
  inserts: [],
  updates: [],
  deletes: [],
  sourceSet: null,
  sourceCats: [],
  newSetId: "set-clone",
};

function mockSupabase() {
  return {
    from: (table: string) => tableChain(table),
  };
}

function tableChain(table: string) {
  type Op =
    | { kind: "select"; cols: string }
    | { kind: "insert"; rows: unknown }
    | { kind: "update"; patch: unknown }
    | { kind: "delete" };
  const op: { current: Op | null; filters: Filter[] } = {
    current: null,
    filters: [],
  };
  const chain: Record<string, unknown> = {
    select(cols: string) {
      op.current = { kind: "select", cols };
      return chain;
    },
    insert(rows: unknown) {
      op.current = { kind: "insert", rows };
      state.inserts.push({ table, rows });
      const insertChain: Record<string, unknown> = {
        select: () => insertChain,
        single: () =>
          Promise.resolve({
            data: { id: state.newSetId },
            error: null,
          }),
        then: (resolve: (v: { data: null; error: null }) => void) => {
          resolve({ data: null, error: null });
        },
      };
      return insertChain;
    },
    update(patch: unknown) {
      op.current = { kind: "update", patch };
      return chain;
    },
    delete() {
      op.current = { kind: "delete" };
      return chain;
    },
    eq(col: string, value: unknown) {
      op.filters.push({ col, op: "eq", value });
      return chain;
    },
    single() {
      if (table === "category_sets") {
        return Promise.resolve({
          data: state.sourceSet,
          error: state.sourceSet ? null : { message: "no rows" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (v: { data: unknown; error: null }) => void) {
      if (op.current?.kind === "update") {
        state.updates.push({
          table,
          patch: op.current.patch,
          filters: [...op.filters],
        });
      } else if (op.current?.kind === "delete") {
        state.deletes.push({ table, filters: [...op.filters] });
      } else if (op.current?.kind === "select") {
        if (table === "categories") {
          resolve({ data: state.sourceCats, error: null });
          return;
        }
      }
      resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  cloneCategorySetAction,
  createCategoryAction,
  createCategorySetAction,
  deleteCategoryAction,
  deleteCategorySetAction,
  updateCategoryAction,
  updateCategorySetAction,
} from "./actions";

function reset(): void {
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
  state.sourceSet = null;
  state.sourceCats = [];
  state.newSetId = "set-clone";
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createCategorySetAction", () => {
  beforeEach(reset);

  it("inserts a category_sets row with team + creator stamps", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await createCategorySetAction(
      fd({ team_id: "t-1", name: "Default", description: "Core" }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toEqual({
      table: "category_sets",
      rows: {
        team_id: "t-1",
        name: "Default",
        description: "Core",
        is_system: false,
        created_by: fakeUserId,
      },
    });
  });

  it("rejects empty / whitespace name", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await expect(
      createCategorySetAction(fd({ team_id: "t-1", name: "  " })),
    ).rejects.toThrow(/Set name/);
    expect(state.inserts).toHaveLength(0);
  });

  it("description normalizes empty string to null", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await createCategorySetAction(
      fd({ team_id: "t-1", name: "X", description: "" }),
    );
    expect(
      (state.inserts[0]?.rows as Record<string, unknown>).description,
    ).toBeNull();
  });
});

describe("cloneCategorySetAction", () => {
  beforeEach(reset);

  it("rejects when the source set is not found", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    state.sourceSet = null;
    await expect(
      cloneCategorySetAction(
        fd({ team_id: "t-1", source_id: "s-nope", name: "" }),
      ),
    ).rejects.toThrow(/Source set not found/);
  });

  it("creates a new set + bulk-inserts its categories on a successful clone", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    state.sourceSet = {
      id: "s-1",
      name: "Source",
      description: "Source desc",
    };
    state.sourceCats = [
      { name: "Cat A", color: "#aaa", sort_order: 0 },
      { name: "Cat B", color: "#bbb", sort_order: 1 },
    ];
    state.newSetId = "s-clone";
    await cloneCategorySetAction(
      fd({ team_id: "t-1", source_id: "s-1", name: "" }),
    );
    // The new category set insert
    const setInsert = state.inserts.find(
      (i) => i.table === "category_sets",
    );
    expect(setInsert).toBeDefined();
    expect((setInsert?.rows as Record<string, unknown>).name).toBe(
      "Source",
    );
    // Bulk insert of categories
    const catInsert = state.inserts.find((i) => i.table === "categories");
    expect(catInsert).toBeDefined();
    expect(catInsert?.rows).toEqual([
      {
        category_set_id: "s-clone",
        name: "Cat A",
        color: "#aaa",
        sort_order: 0,
      },
      {
        category_set_id: "s-clone",
        name: "Cat B",
        color: "#bbb",
        sort_order: 1,
      },
    ]);
  });

  it("clone with explicit name overrides the source name", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    state.sourceSet = {
      id: "s-1",
      name: "Source",
      description: null,
    };
    await cloneCategorySetAction(
      fd({ team_id: "t-1", source_id: "s-1", name: "My copy" }),
    );
    const setInsert = state.inserts.find(
      (i) => i.table === "category_sets",
    );
    expect((setInsert?.rows as Record<string, unknown>).name).toBe(
      "My copy",
    );
  });

  it("clone with empty source-categories list skips the bulk insert", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    state.sourceSet = { id: "s-1", name: "Empty", description: null };
    state.sourceCats = [];
    await cloneCategorySetAction(
      fd({ team_id: "t-1", source_id: "s-1", name: "" }),
    );
    expect(
      state.inserts.find((i) => i.table === "categories"),
    ).toBeUndefined();
  });
});

describe("updateCategorySetAction / deleteCategorySetAction", () => {
  beforeEach(reset);

  it("updateCategorySet scopes by (id, team_id) — cross-team defense", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await updateCategorySetAction(
      fd({ id: "s-1", team_id: "t-1", name: "Renamed" }),
    );
    const u = state.updates[0];
    expect(u?.table).toBe("category_sets");
    expect(u?.filters).toContainEqual({
      col: "id",
      op: "eq",
      value: "s-1",
    });
    expect(u?.filters).toContainEqual({
      col: "team_id",
      op: "eq",
      value: "t-1",
    });
  });

  it("updateCategorySet rejects empty name", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await expect(
      updateCategorySetAction(fd({ id: "s-1", team_id: "t-1", name: "" })),
    ).rejects.toThrow(/Set name/);
  });

  it("deleteCategorySet scopes by (id, team_id) — cross-team defense", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await deleteCategorySetAction(fd({ id: "s-1", team_id: "t-1" }));
    const d = state.deletes[0];
    expect(d?.table).toBe("category_sets");
    expect(d?.filters).toContainEqual({
      col: "id",
      op: "eq",
      value: "s-1",
    });
    expect(d?.filters).toContainEqual({
      col: "team_id",
      op: "eq",
      value: "t-1",
    });
  });
});

describe("createCategory / updateCategory / deleteCategory", () => {
  beforeEach(reset);

  it("createCategory inserts with the user-supplied color (or default #6b7280)", async () => {
    await createCategoryAction(
      fd({ category_set_id: "s-1", name: "Bug fix" }),
    );
    expect(state.inserts[0]?.rows).toEqual({
      category_set_id: "s-1",
      name: "Bug fix",
      color: "#6b7280",
      sort_order: 0,
    });
  });

  it("createCategory rejects empty name", async () => {
    await expect(
      createCategoryAction(fd({ category_set_id: "s-1", name: "   " })),
    ).rejects.toThrow(/Category name/);
  });

  it("createCategory parses sort_order as int", async () => {
    await createCategoryAction(
      fd({
        category_set_id: "s-1",
        name: "X",
        sort_order: "42",
      }),
    );
    expect((state.inserts[0]?.rows as Record<string, unknown>).sort_order).toBe(
      42,
    );
  });

  it("updateCategory writes the patch scoped by id", async () => {
    await updateCategoryAction(
      fd({ id: "c-1", name: "Renamed", color: "#ff0000", sort_order: "5" }),
    );
    const u = state.updates[0];
    expect(u?.table).toBe("categories");
    expect(u?.patch).toEqual({
      name: "Renamed",
      color: "#ff0000",
      sort_order: 5,
    });
    expect(u?.filters).toEqual([{ col: "id", op: "eq", value: "c-1" }]);
  });

  it("updateCategory rejects empty name", async () => {
    await expect(
      updateCategoryAction(fd({ id: "c-1", name: "" })),
    ).rejects.toThrow(/Category name/);
  });

  it("deleteCategory issues a scoped DELETE by id", async () => {
    await deleteCategoryAction(fd({ id: "c-1" }));
    expect(state.deletes[0]).toEqual({
      table: "categories",
      filters: [{ col: "id", op: "eq", value: "c-1" }],
    });
  });
});
