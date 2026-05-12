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
  template:
    | {
        team_id: string;
        project_id: string;
        category_id: string | null;
        description: string | null;
        billable: boolean;
      }
    | null;
} = {
  inserts: [],
  updates: [],
  deletes: [],
  template: null,
};

function mockSupabase() {
  return {
    from: (table: string) => tableChain(table),
  };
}

function tableChain(table: string) {
  type Op =
    | { kind: "select" }
    | { kind: "insert"; rows: unknown }
    | { kind: "update"; patch: unknown }
    | { kind: "delete" };
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
      op.current = { kind: "insert", rows };
      state.inserts.push({ table, rows });
      const insertChain: Record<string, unknown> = {
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
    is(col: string, value: unknown) {
      op.filters.push({ col, op: "is", value });
      return chain;
    },
    single() {
      if (table === "time_templates") {
        return Promise.resolve({
          data: state.template,
          error: state.template ? null : { message: "no rows" },
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
  createTemplateAction,
  deleteTemplateAction,
  startFromTemplateAction,
  updateTemplateAction,
} from "./actions";

function reset(): void {
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
  state.template = null;
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createTemplateAction", () => {
  beforeEach(reset);

  it("inserts a time_templates row with team + user stamps", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await createTemplateAction(
      fd({
        team_id: "t-1",
        project_id: "p-1",
        category_id: "cat-1",
        name: "Daily standup",
        description: "Daily standup notes",
        billable: "on",
        sort_order: "5",
      }),
    );
    expect(state.inserts[0]?.rows).toEqual({
      team_id: "t-1",
      user_id: fakeUserId,
      project_id: "p-1",
      category_id: "cat-1",
      name: "Daily standup",
      description: "Daily standup notes",
      billable: true,
      sort_order: 5,
    });
  });

  it("rejects empty name", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await expect(
      createTemplateAction(fd({ team_id: "t-1", project_id: "p-1", name: " " })),
    ).rejects.toThrow(/Template name/);
  });

  it("rejects missing project_id", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await expect(
      createTemplateAction(fd({ team_id: "t-1", name: "X" })),
    ).rejects.toThrow(/Project is required/);
  });

  it("billable defaults to false when not checked", async () => {
    mockValidateTeamAccess.mockResolvedValue({});
    await createTemplateAction(
      fd({ team_id: "t-1", project_id: "p-1", name: "X" }),
    );
    expect((state.inserts[0]?.rows as Record<string, unknown>).billable).toBe(
      false,
    );
  });
});

describe("updateTemplateAction", () => {
  beforeEach(reset);

  it("updates scoped by (id, user_id) — per-user template defense", async () => {
    await updateTemplateAction(
      fd({
        id: "tpl-1",
        project_id: "p-1",
        name: "Updated",
        billable: "on",
      }),
    );
    const u = state.updates[0];
    expect(u?.table).toBe("time_templates");
    expect(u?.filters).toContainEqual({
      col: "id",
      op: "eq",
      value: "tpl-1",
    });
    expect(u?.filters).toContainEqual({
      col: "user_id",
      op: "eq",
      value: fakeUserId,
    });
  });

  it("rejects empty name", async () => {
    await expect(
      updateTemplateAction(fd({ id: "tpl-1", project_id: "p-1", name: "" })),
    ).rejects.toThrow(/Template name/);
  });

  it("rejects missing project_id", async () => {
    await expect(
      updateTemplateAction(fd({ id: "tpl-1", name: "X" })),
    ).rejects.toThrow(/Project is required/);
  });
});

describe("deleteTemplateAction", () => {
  beforeEach(reset);

  it("deletes scoped by (id, user_id)", async () => {
    await deleteTemplateAction(fd({ id: "tpl-1" }));
    const d = state.deletes[0];
    expect(d?.table).toBe("time_templates");
    expect(d?.filters).toContainEqual({
      col: "id",
      op: "eq",
      value: "tpl-1",
    });
    expect(d?.filters).toContainEqual({
      col: "user_id",
      op: "eq",
      value: fakeUserId,
    });
  });
});

describe("startFromTemplateAction", () => {
  beforeEach(reset);

  it("rejects when the template is not found / not owned by the user", async () => {
    state.template = null;
    await expect(
      startFromTemplateAction(fd({ template_id: "tpl-nope" })),
    ).rejects.toThrow(/Template not found/);
  });

  it("stops any running entry then inserts a new running entry from the template", async () => {
    state.template = {
      team_id: "t-1",
      project_id: "p-1",
      category_id: "cat-1",
      description: "From template",
      billable: true,
    };
    await startFromTemplateAction(fd({ template_id: "tpl-1" }));

    // The stop-running UPDATE is scoped by user + end_time IS NULL +
    // deleted_at IS NULL.
    const stopRunning = state.updates.find(
      (u) =>
        u.table === "time_entries" &&
        (u.patch as Record<string, unknown>).end_time !== undefined,
    );
    expect(stopRunning).toBeDefined();
    expect(stopRunning?.filters).toContainEqual({
      col: "user_id",
      op: "eq",
      value: fakeUserId,
    });
    expect(stopRunning?.filters).toContainEqual({
      col: "end_time",
      op: "is",
      value: null,
    });
    expect(stopRunning?.filters).toContainEqual({
      col: "deleted_at",
      op: "is",
      value: null,
    });

    // The new running entry insert carries the template's fields.
    const newEntry = state.inserts.find((i) => i.table === "time_entries");
    expect(newEntry).toBeDefined();
    const row = newEntry?.rows as Record<string, unknown>;
    expect(row.team_id).toBe("t-1");
    expect(row.project_id).toBe("p-1");
    expect(row.category_id).toBe("cat-1");
    expect(row.description).toBe("From template");
    expect(row.billable).toBe(true);
    expect(row.end_time).toBeNull();
  });

  it("bumps the template's last_used_at on use", async () => {
    state.template = {
      team_id: "t-1",
      project_id: "p-1",
      category_id: null,
      description: null,
      billable: false,
    };
    await startFromTemplateAction(fd({ template_id: "tpl-1" }));
    const bump = state.updates.find(
      (u) =>
        u.table === "time_templates" &&
        (u.patch as Record<string, unknown>).last_used_at !== undefined,
    );
    expect(bump).toBeDefined();
    expect(bump?.filters).toContainEqual({
      col: "id",
      op: "eq",
      value: "tpl-1",
    });
    expect(bump?.filters).toContainEqual({
      col: "user_id",
      op: "eq",
      value: fakeUserId,
    });
  });
});
