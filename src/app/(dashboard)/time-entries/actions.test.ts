import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Action-layer tests for the time-entries surface. The 13 exports
 * range from trivial (stopTimerAction is one UPDATE) to load-bearing
 * (createTimeEntryAction touches projects + tickets + entries with
 * timezone math). We focus on the highest-value coverage gaps:
 *
 *   - delete / restore / permanently-delete (soft-delete invariants)
 *   - stopTimer (RLS + user_id defense)
 *   - bulk delete / restore (auth scope, no-op on empty input)
 *
 * Heavyweight paths (createTimeEntryAction, startTimerAction,
 * duplicateTimeEntryAction) are intentionally out of scope — they
 * deserve dedicated test files with full project/ticket fixtures.
 * This file establishes the harness so those can copy the shape.
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

// Ticket builder is unrelated to delete/stop/restore paths.
vi.mock("@/lib/tickets/attach", () => ({
  buildTicketAttachment: vi.fn().mockResolvedValue({}),
}));

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

interface ProjectFixture {
  team_id: string;
  is_internal: boolean;
  default_billable: boolean;
}

const state: {
  updates: { table: string; patch: unknown; filters: Filter[] }[];
  deletes: { table: string; filters: Filter[] }[];
  inserts: { table: string; rows: unknown }[];
  updateError: { message: string } | null;
  /** What `.from("projects").select("...").eq("id", X).single()` returns
   *  when createTimeEntryAction / startTimerAction looks up the
   *  project. `null` simulates "project not found". */
  project: ProjectFixture | null;
  /** Existing same-day entry on (user, project, category) that
   *  startTimerAction may resume. `null` means "no row, create new." */
  resumeEntry: { id: string; duration_min: number; description: string | null } | null;
} = {
  updates: [],
  deletes: [],
  inserts: [],
  updateError: null,
  project: null,
  resumeEntry: null,
};

function mockSupabase() {
  return {
    from: (table: string) => {
      if (table === "projects") return projectChain();
      if (table === "time_entries") return tableChain(table);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function projectChain() {
  // Production calls .from("projects").select("...").eq("id", x).single()
  // We ignore the filter args and return state.project.
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.single = () =>
    state.project
      ? Promise.resolve({ data: state.project, error: null })
      : Promise.resolve({
          data: null,
          error: { message: "no project", code: "PGRST116" },
        });
  return q;
}

/**
 * Chain that records every filter call and resolves once the
 * terminal (`update().<filters>` or `delete().<filters>`) is awaited.
 * The action code uses `assertSupabaseOk(await ...)` which awaits
 * the chain directly — so the chain itself must be a thenable.
 */
function tableChain(table: string) {
  type Op =
    | { kind: "update"; patch: unknown }
    | { kind: "delete" }
    | { kind: "select" };
  const op: { current: Op | null; filters: Filter[] } = {
    current: null,
    filters: [],
  };
  const chain: Record<string, unknown> = {
    select() {
      // Read path used by startTimerAction's resume-lookup. The chain
      // resolves to state.resumeEntry when awaited (.maybeSingle()
      // OR direct await on the chain).
      op.current = { kind: "select" };
      return chain;
    },
    insert(rows: unknown) {
      // Record the insert and return a chain that's awaitable.
      state.inserts.push({ table, rows });
      const insertChain: Record<string, unknown> = {
        select: () => insertChain,
        single: () =>
          Promise.resolve({
            data: { id: "new-entry-id" },
            error: state.updateError,
          }),
        then: (resolve: (v: { data: null; error: unknown }) => void) => {
          resolve({ data: null, error: state.updateError });
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
    in(col: string, value: unknown) {
      op.filters.push({ col, op: "in", value });
      return chain;
    },
    not(col: string, _op: string, value: unknown) {
      op.filters.push({ col, op: "not.is", value });
      return chain;
    },
    gte(col: string, value: unknown) {
      op.filters.push({ col, op: "gte", value });
      return chain;
    },
    lt(col: string, value: unknown) {
      op.filters.push({ col, op: "lt", value });
      return chain;
    },
    limit() {
      return chain;
    },
    maybeSingle() {
      return Promise.resolve({ data: state.resumeEntry, error: null });
    },
    then(resolve: (v: { data: unknown; error: unknown }) => void) {
      // Record the operation when the chain is awaited.
      if (op.current?.kind === "update") {
        state.updates.push({
          table,
          patch: op.current.patch,
          filters: [...op.filters],
        });
      } else if (op.current?.kind === "delete") {
        state.deletes.push({ table, filters: [...op.filters] });
      } else if (op.current?.kind === "select") {
        // Treat the awaited select as the "resume lookup" path —
        // returns either the seeded resumeEntry (wrapped in an
        // array per Supabase's list shape) or an empty array.
        const data = state.resumeEntry ? [state.resumeEntry] : [];
        resolve({ data, error: null });
        return;
      }
      resolve({ data: null, error: state.updateError });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  createTimeEntryAction,
  deleteTimeEntriesAction,
  deleteTimeEntryAction,
  permanentlyDeleteTimeEntryAction,
  restoreTimeEntriesAction,
  restoreTimeEntryAction,
  stopTimerAction,
} from "./actions";

function reset(): void {
  state.updates = [];
  state.deletes = [];
  state.inserts = [];
  state.updateError = null;
  state.project = null;
  state.resumeEntry = null;
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) {
      for (const one of v) f.append(k, one);
    } else {
      f.set(k, v);
    }
  }
  return f;
}

function findFilter(
  filters: Filter[],
  col: string,
): Filter | undefined {
  return filters.find((f) => f.col === col);
}

describe("deleteTimeEntryAction", () => {
  beforeEach(reset);

  it("soft-deletes by setting deleted_at, scoped to (id, user_id, deleted_at IS NULL)", async () => {
    await deleteTimeEntryAction(fd({ id: "e-1" }));

    expect(state.updates).toHaveLength(1);
    const u = state.updates[0]!;
    const patch = u.patch as Record<string, unknown>;
    expect(patch.deleted_at).toBeTypeOf("string");
    expect(findFilter(u.filters, "id")?.value).toBe("e-1");
    expect(findFilter(u.filters, "user_id")?.value).toBe(fakeUserId);
    // is("deleted_at", null) prevents re-deleting an already-trashed
    // entry — keeps the soft-delete idempotent.
    expect(findFilter(u.filters, "deleted_at")?.op).toBe("is");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/time-entries");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/time-entries/trash");
  });
});

describe("restoreTimeEntryAction", () => {
  beforeEach(reset);

  it("flips deleted_at to null, scoped to (id, user_id, deleted_at IS NOT NULL)", async () => {
    await restoreTimeEntryAction(fd({ id: "e-1" }));

    expect(state.updates).toHaveLength(1);
    const u = state.updates[0]!;
    expect(u.patch).toEqual({ deleted_at: null });
    expect(findFilter(u.filters, "id")?.value).toBe("e-1");
    expect(findFilter(u.filters, "user_id")?.value).toBe(fakeUserId);
    // not("deleted_at", "is", null) — the row must currently be
    // soft-deleted to be restored. Prevents UPDATEs on active rows.
    expect(findFilter(u.filters, "deleted_at")?.op).toBe("not.is");
  });
});

describe("permanentlyDeleteTimeEntryAction", () => {
  beforeEach(reset);

  it("hard-deletes with the same trash-only guard as restore", async () => {
    await permanentlyDeleteTimeEntryAction(fd({ id: "e-1" }));

    expect(state.deletes).toHaveLength(1);
    const d = state.deletes[0]!;
    expect(findFilter(d.filters, "id")?.value).toBe("e-1");
    expect(findFilter(d.filters, "user_id")?.value).toBe(fakeUserId);
    // not("deleted_at", "is", null) — only trashed rows can be hard
    // deleted, so an accidental call on an active entry is a no-op.
    expect(findFilter(d.filters, "deleted_at")?.op).toBe("not.is");
  });
});

describe("stopTimerAction", () => {
  beforeEach(reset);

  it("sets end_time to now, scoped by (id, user_id)", async () => {
    await stopTimerAction(fd({ id: "e-1" }));

    expect(state.updates).toHaveLength(1);
    const u = state.updates[0]!;
    const patch = u.patch as Record<string, unknown>;
    expect(patch.end_time).toBeTypeOf("string");
    expect(findFilter(u.filters, "id")?.value).toBe("e-1");
    // user_id defense-in-depth (RLS would catch cross-user too).
    expect(findFilter(u.filters, "user_id")?.value).toBe(fakeUserId);
  });
});

describe("deleteTimeEntriesAction", () => {
  beforeEach(reset);

  it("soft-deletes the given ids, scoped to user_id + deleted_at IS NULL", async () => {
    await deleteTimeEntriesAction(fd({ id: ["e-1", "e-2", "e-3"] }));

    expect(state.updates).toHaveLength(1);
    const u = state.updates[0]!;
    const patch = u.patch as Record<string, unknown>;
    expect(patch.deleted_at).toBeTypeOf("string");
    expect(findFilter(u.filters, "id")?.op).toBe("in");
    expect(findFilter(u.filters, "id")?.value).toEqual([
      "e-1",
      "e-2",
      "e-3",
    ]);
    expect(findFilter(u.filters, "user_id")?.value).toBe(fakeUserId);
  });

  it("is a no-op when no ids are submitted (no UPDATE fires)", async () => {
    await deleteTimeEntriesAction(fd({}));

    expect(state.updates).toEqual([]);
    // No revalidate either — nothing changed.
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("restoreTimeEntriesAction", () => {
  beforeEach(reset);

  it("clears deleted_at on the given ids, requires deleted_at IS NOT NULL", async () => {
    await restoreTimeEntriesAction(fd({ id: ["e-1", "e-2"] }));

    expect(state.updates).toHaveLength(1);
    const u = state.updates[0]!;
    expect(u.patch).toEqual({ deleted_at: null });
    expect(findFilter(u.filters, "id")?.value).toEqual(["e-1", "e-2"]);
    expect(findFilter(u.filters, "deleted_at")?.op).toBe("not.is");
  });

  it("is a no-op when no ids are submitted", async () => {
    await restoreTimeEntriesAction(fd({}));
    expect(state.updates).toEqual([]);
  });
});

describe("createTimeEntryAction", () => {
  beforeEach(reset);

  it("inserts a row using the project's team_id (NEVER trusts the form's team_id)", async () => {
    state.project = {
      team_id: "team-from-project",
      is_internal: false,
      default_billable: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createTimeEntryAction(
      fd({
        // Forged team_id should be ignored — the action derives
        // team_id from the project lookup.
        team_id: "team-FORGED",
        project_id: "p-1",
        description: "design review",
        start_time: "2026-04-15T10:00:00.000Z",
        end_time: "2026-04-15T11:00:00.000Z",
      }),
    );

    expect(state.inserts).toHaveLength(1);
    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.team_id).toBe("team-from-project");
    expect(row.project_id).toBe("p-1");
    expect(row.description).toBe("design review");
    expect(mockValidateTeamAccess).toHaveBeenCalledWith("team-from-project");
  });

  it("forces billable=false on internal projects (defense in depth — form may submit billable=on)", async () => {
    state.project = {
      team_id: "team-1",
      is_internal: true,
      default_billable: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createTimeEntryAction(
      fd({
        project_id: "p-internal",
        billable: "on", // forged
        start_time: "2026-04-15T10:00:00.000Z",
      }),
    );

    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.billable).toBe(false);
  });

  it("inherits the project's default_billable when no `billable` field is present", async () => {
    state.project = {
      team_id: "team-1",
      is_internal: false,
      default_billable: false,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createTimeEntryAction(
      fd({
        project_id: "p-1",
        // No `billable` key at all → falls back to project default.
        start_time: "2026-04-15T10:00:00.000Z",
      }),
    );

    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.billable).toBe(false);
  });

  it("respects an explicit billable=on submission on a non-internal project", async () => {
    state.project = {
      team_id: "team-1",
      is_internal: false,
      default_billable: false,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createTimeEntryAction(
      fd({
        project_id: "p-1",
        billable: "on",
        start_time: "2026-04-15T10:00:00.000Z",
      }),
    );

    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.billable).toBe(true);
  });

  it("rejects when project_id is missing (no DB read at all)", async () => {
    await expect(
      createTimeEntryAction(fd({ start_time: "2026-04-15T10:00:00Z" })),
    ).rejects.toThrow(/project_id is required/);
    expect(state.inserts).toEqual([]);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
  });

  it("rejects when the project lookup fails (RLS or stale id)", async () => {
    state.project = null;
    await expect(
      createTimeEntryAction(
        fd({
          project_id: "p-missing",
          start_time: "2026-04-15T10:00:00Z",
        }),
      ),
    ).rejects.toThrow(/Project not found/);
    expect(state.inserts).toEqual([]);
  });

  it("duration mode — synthesizes start/end from entry_date + duration_min + tz_offset", async () => {
    state.project = {
      team_id: "team-1",
      is_internal: false,
      default_billable: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createTimeEntryAction(
      fd({
        project_id: "p-1",
        entry_date: "2026-04-15",
        duration_min: "90",
        tz_offset_min: "0",
      }),
    );

    const row = state.inserts[0]?.rows as Record<string, unknown>;
    // 2026-04-15 local-midnight at UTC offset 0 == 2026-04-15T00:00:00Z.
    expect(row.start_time).toBe("2026-04-15T00:00:00.000Z");
    // 90 min later.
    expect(row.end_time).toBe("2026-04-15T01:30:00.000Z");
  });

  it("ignores out-of-range tz_offset_min (>840 min) and falls back to 0", async () => {
    state.project = {
      team_id: "team-1",
      is_internal: false,
      default_billable: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createTimeEntryAction(
      fd({
        project_id: "p-1",
        entry_date: "2026-04-15",
        duration_min: "60",
        // Earth's TZ range is ±14 hours (±840 min). Anything beyond
        // that is hostile / forged input — the action clamps to 0.
        tz_offset_min: "9999",
      }),
    );

    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.start_time).toBe("2026-04-15T00:00:00.000Z");
  });
});
