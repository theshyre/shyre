import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  runSafeActionMock,
  validateTeamAccessMock,
  requireTeamAdminMock,
  revalidatePathMock,
  assertSupabaseOkMock,
  state,
} = vi.hoisted(() => {
  const state: {
    inserts: Array<{ table: string; row: unknown }>;
    deletes: Array<{ table: string; filters: Array<{ col: string; op: string; value: unknown }> }>;
    insertError: { code?: string; message: string } | null;
    deleteError: { code?: string; message: string } | null;
    project: { id: string; team_id: string } | null;
  } = {
    inserts: [],
    deletes: [],
    insertError: null,
    deleteError: null,
    project: null,
  };
  return {
    state,
    revalidatePathMock: vi.fn(),
    validateTeamAccessMock: vi.fn(async () => ({
      userId: "user-1",
      role: "member" as const,
    })),
    requireTeamAdminMock: vi.fn(async () => ({
      userId: "user-1",
      role: "admin" as const,
    })),
    assertSupabaseOkMock: vi.fn(),
    runSafeActionMock: vi.fn(
      async (
        fd: FormData,
        fn: (
          fd: FormData,
          ctx: { supabase: unknown; userId: string },
        ) => Promise<void>,
        _name: string,
      ) => {
        const supabase = {
          from: (table: string) => {
            const filters: Array<{ col: string; op: string; value: unknown }> = [];
            const chain: Record<string, unknown> = {
              insert: (row: unknown) => {
                state.inserts.push({ table, row });
                return Promise.resolve({ error: state.insertError });
              },
              delete: () => chain,
              select: () => chain,
              eq: (col: string, value: unknown) => {
                filters.push({ col, op: "eq", value });
                return chain;
              },
              is: (col: string, value: unknown) => {
                filters.push({ col, op: "is", value });
                return chain;
              },
              maybeSingle: () =>
                Promise.resolve({ data: state.project, error: null }),
              then: (resolve: (v: { data: null; error: unknown }) => void) => {
                state.deletes.push({ table, filters: [...filters] });
                resolve({ data: null, error: state.deleteError });
              },
            };
            return chain;
          },
        };
        await fn(fd, { supabase, userId: "user-1" });
      },
    ),
  };
});

vi.mock("@/lib/safe-action", () => ({
  runSafeAction: (...args: unknown[]) =>
    runSafeActionMock(...(args as Parameters<typeof runSafeActionMock>)),
}));

vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (...args: unknown[]) =>
    validateTeamAccessMock(...(args as Parameters<typeof validateTeamAccessMock>)),
  requireTeamAdmin: (...args: unknown[]) =>
    requireTeamAdminMock(...(args as Parameters<typeof requireTeamAdminMock>)),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("@/lib/errors", () => ({
  assertSupabaseOk: (r: unknown) => assertSupabaseOkMock(r),
}));

import {
  pinRowAction,
  unpinRowAction,
  setTeamDefaultRowAction,
  unsetTeamDefaultRowAction,
} from "./pinned-rows-actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.inserts = [];
  state.deletes = [];
  state.insertError = null;
  state.deleteError = null;
  state.project = null;
  runSafeActionMock.mockClear();
  validateTeamAccessMock.mockClear();
  requireTeamAdminMock.mockClear();
  revalidatePathMock.mockClear();
  assertSupabaseOkMock.mockClear();
});

describe("pinRowAction", () => {
  it("inserts into time_pinned_rows with the form values + auth user", async () => {
    await pinRowAction(
      fd({ team_id: "t-1", project_id: "p-1", category_id: "c-1" }),
    );
    expect(state.inserts).toEqual([
      {
        table: "time_pinned_rows",
        row: {
          team_id: "t-1",
          user_id: "user-1",
          project_id: "p-1",
          category_id: "c-1",
        },
      },
    ]);
  });

  it("passes null category_id when the form omits it", async () => {
    await pinRowAction(fd({ team_id: "t-1", project_id: "p-1" }));
    const row = state.inserts[0]?.row as { category_id: string | null };
    expect(row.category_id).toBeNull();
  });

  it("validates team access (defense in depth)", async () => {
    await pinRowAction(fd({ team_id: "t-1", project_id: "p-1" }));
    expect(validateTeamAccessMock).toHaveBeenCalledWith("t-1");
  });

  it("revalidates /time-entries on success", async () => {
    await pinRowAction(fd({ team_id: "t-1", project_id: "p-1" }));
    expect(revalidatePathMock).toHaveBeenCalledWith("/time-entries");
  });

  it("treats 23505 (unique-violation) as a no-op success", async () => {
    state.insertError = { code: "23505", message: "duplicate" };
    await expect(
      pinRowAction(fd({ team_id: "t-1", project_id: "p-1" })),
    ).resolves.toBeUndefined();
    expect(revalidatePathMock).toHaveBeenCalled();
  });

  it("rethrows non-23505 errors", async () => {
    state.insertError = { code: "42501", message: "RLS denied" };
    await expect(
      pinRowAction(fd({ team_id: "t-1", project_id: "p-1" })),
    ).rejects.toMatchObject({ message: "RLS denied" });
  });

  it("rejects when team_id is missing", async () => {
    await expect(pinRowAction(fd({ project_id: "p-1" }))).rejects.toThrow(
      /team_id is required/,
    );
  });

  it("rejects when project_id is missing", async () => {
    await expect(pinRowAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /project_id is required/,
    );
  });
});

describe("unpinRowAction", () => {
  it("deletes by (team_id, user_id, project_id, category_id)", async () => {
    await unpinRowAction(
      fd({ team_id: "t-1", project_id: "p-1", category_id: "c-1" }),
    );
    const d = state.deletes[0];
    expect(d?.table).toBe("time_pinned_rows");
    expect(d?.filters).toEqual(
      expect.arrayContaining([
        { col: "team_id", op: "eq", value: "t-1" },
        { col: "user_id", op: "eq", value: "user-1" },
        { col: "project_id", op: "eq", value: "p-1" },
        { col: "category_id", op: "eq", value: "c-1" },
      ]),
    );
  });

  it("uses .is(null) for null category_id", async () => {
    await unpinRowAction(fd({ team_id: "t-1", project_id: "p-1" }));
    const d = state.deletes[0];
    expect(d?.filters).toEqual(
      expect.arrayContaining([
        { col: "category_id", op: "is", value: null },
      ]),
    );
  });

  it("validates team access", async () => {
    await unpinRowAction(fd({ team_id: "t-1", project_id: "p-1" }));
    expect(validateTeamAccessMock).toHaveBeenCalledWith("t-1");
  });
});

describe("setTeamDefaultRowAction", () => {
  it("requires team admin and validates the project belongs to the team", async () => {
    state.project = { id: "p-1", team_id: "t-1" };
    await setTeamDefaultRowAction(
      fd({ team_id: "t-1", project_id: "p-1", category_id: "c-1" }),
    );
    expect(requireTeamAdminMock).toHaveBeenCalledWith("t-1");
    expect(state.inserts).toEqual([
      {
        table: "time_team_default_rows",
        row: {
          team_id: "t-1",
          project_id: "p-1",
          category_id: "c-1",
          created_by_user_id: "user-1",
        },
      },
    ]);
  });

  it("rejects when the project belongs to a different team", async () => {
    state.project = { id: "p-1", team_id: "t-OTHER" };
    await expect(
      setTeamDefaultRowAction(fd({ team_id: "t-1", project_id: "p-1" })),
    ).rejects.toThrow(/Project not found on this team/);
  });

  it("rejects when the project does not exist", async () => {
    state.project = null;
    await expect(
      setTeamDefaultRowAction(fd({ team_id: "t-1", project_id: "p-1" })),
    ).rejects.toThrow(/Project not found/);
  });

  it("treats 23505 as no-op success", async () => {
    state.project = { id: "p-1", team_id: "t-1" };
    state.insertError = { code: "23505", message: "duplicate" };
    await expect(
      setTeamDefaultRowAction(fd({ team_id: "t-1", project_id: "p-1" })),
    ).resolves.toBeUndefined();
  });
});

describe("unsetTeamDefaultRowAction", () => {
  it("requires team admin and deletes the matching row", async () => {
    await unsetTeamDefaultRowAction(
      fd({ team_id: "t-1", project_id: "p-1", category_id: "c-1" }),
    );
    expect(requireTeamAdminMock).toHaveBeenCalledWith("t-1");
    const d = state.deletes[0];
    expect(d?.table).toBe("time_team_default_rows");
    expect(d?.filters).toEqual(
      expect.arrayContaining([
        { col: "team_id", op: "eq", value: "t-1" },
        { col: "project_id", op: "eq", value: "p-1" },
        { col: "category_id", op: "eq", value: "c-1" },
      ]),
    );
  });
});
