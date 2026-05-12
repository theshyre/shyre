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

// Ticket builder is mocked so individual tests can dictate what the
// attach helper "resolves" to. autoFillDescription is the real
// implementation — tests that care about the description-auto-fill
// behaviour drive it via the buildTicketAttachment fixture below.
const ticketAttachmentMock = vi.fn();
vi.mock("@/lib/tickets/attach", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/tickets/attach")
  >("@/lib/tickets/attach");
  return {
    ...actual,
    buildTicketAttachment: (...args: unknown[]) =>
      ticketAttachmentMock(...args),
  };
});

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
  /** Row returned by `.from("time_entries").select("project_id,
   *  projects(is_internal)").eq("id", X).maybeSingle()` —
   *  updateTimeEntryAction consults this to enforce internal-only
   *  rules. */
  existingTimeEntry:
    | { project_id: string | null; projects: { is_internal: boolean } | null }
    | null;
} = {
  updates: [],
  deletes: [],
  inserts: [],
  updateError: null,
  project: null,
  resumeEntry: null,
  existingTimeEntry: null,
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
      // updateTimeEntryAction's project-classification probe uses
      // .select("project_id, projects(is_internal)").eq("id", X)
      //   .maybeSingle() and expects a row-shape, not a list.
      // startTimerAction's resume-lookup is also a maybeSingle but
      // wants the resume-entry shape. We pick by which select() the
      // chain saw last: if the filters include `id`, it's the update
      // path; otherwise fall through to the resume shape.
      const wantsExisting =
        op.filters.some((f) => f.col === "id") &&
        state.existingTimeEntry !== null;
      return Promise.resolve({
        data: wantsExisting ? state.existingTimeEntry : state.resumeEntry,
        error: null,
      });
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
  updateTimeEntryAction,
} from "./actions";

const EMPTY_TICKET = {
  linked_ticket_provider: null,
  linked_ticket_key: null,
  linked_ticket_url: null,
  linked_ticket_title: null,
  linked_ticket_refreshed_at: null,
};

function reset(): void {
  state.updates = [];
  state.deletes = [];
  state.inserts = [];
  state.updateError = null;
  state.project = null;
  state.resumeEntry = null;
  state.existingTimeEntry = null;
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
  ticketAttachmentMock.mockReset();
  ticketAttachmentMock.mockResolvedValue(EMPTY_TICKET);
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

  // Regression: a user who typed only a Jira/GitHub key into the
  // ticket field of the new-entry form (no description) saw the row
  // render as "Untitled" because createTimeEntryAction inserted the
  // submitted (empty) description verbatim. Now: when the ticket
  // resolves, the description defaults to "{key} {title}".
  it("auto-fills description with `${key} ${title}` when ticket_ref resolves and description was empty", async () => {
    state.project = {
      team_id: "team-1",
      is_internal: false,
      default_billable: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    ticketAttachmentMock.mockResolvedValue({
      linked_ticket_provider: "jira",
      linked_ticket_key: "AE-644",
      linked_ticket_url: "https://example.atlassian.net/browse/AE-644",
      linked_ticket_title: "Amplify Gen 2 cutover",
      linked_ticket_refreshed_at: "2026-05-12T15:00:00.000Z",
    });

    await createTimeEntryAction(
      fd({
        project_id: "p-1",
        // Empty description — user typed only a ticket key.
        description: "",
        ticket_ref: "AE-644",
        start_time: "2026-05-12T15:00:00.000Z",
      }),
    );

    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.description).toBe("AE-644 Amplify Gen 2 cutover");
    expect(row.linked_ticket_key).toBe("AE-644");
  });

  it("falls back to just the key when the title lookup failed", async () => {
    state.project = {
      team_id: "team-1",
      is_internal: false,
      default_billable: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    ticketAttachmentMock.mockResolvedValue({
      linked_ticket_provider: "jira",
      linked_ticket_key: "AE-644",
      linked_ticket_url: null,
      linked_ticket_title: null,
      linked_ticket_refreshed_at: null,
    });

    await createTimeEntryAction(
      fd({
        project_id: "p-1",
        ticket_ref: "AE-644",
        start_time: "2026-05-12T15:00:00.000Z",
      }),
    );

    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.description).toBe("AE-644");
  });

  it("does NOT overwrite a user-typed description even when a ticket resolves", async () => {
    state.project = {
      team_id: "team-1",
      is_internal: false,
      default_billable: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    ticketAttachmentMock.mockResolvedValue({
      linked_ticket_provider: "jira",
      linked_ticket_key: "AE-644",
      linked_ticket_url: "https://example.atlassian.net/browse/AE-644",
      linked_ticket_title: "Amplify Gen 2 cutover",
      linked_ticket_refreshed_at: "2026-05-12T15:00:00.000Z",
    });

    await createTimeEntryAction(
      fd({
        project_id: "p-1",
        description: "Pairing with QA on the smoke run",
        ticket_ref: "AE-644",
        start_time: "2026-05-12T15:00:00.000Z",
      }),
    );

    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.description).toBe("Pairing with QA on the smoke run");
  });
});

describe("updateTimeEntryAction (field-selective patch)", () => {
  beforeEach(reset);

  function findUpdate(): { patch: Record<string, unknown> } | null {
    const u = state.updates.find((u) => u.table === "time_entries");
    if (!u) return null;
    return { patch: u.patch as Record<string, unknown> };
  }

  it("description-only submit does NOT blank start_time / category_id (regression: prior version coerced missing fields to null, tripping NOT NULL on start_time)", async () => {
    state.existingTimeEntry = {
      project_id: "p-1",
      projects: { is_internal: false },
    };
    await updateTimeEntryAction(
      fd({ id: "e-1", description: "Fix login bug" }),
    );
    const u = findUpdate();
    expect(u).not.toBeNull();
    expect(u!.patch.description).toBe("Fix login bug");
    expect(u!.patch).not.toHaveProperty("start_time");
    expect(u!.patch).not.toHaveProperty("end_time");
    expect(u!.patch).not.toHaveProperty("category_id");
    expect(u!.patch).not.toHaveProperty("billable");
  });

  it("time-only submit (duration_min + entry_date) does NOT blank description / billable / category", async () => {
    await updateTimeEntryAction(
      fd({
        id: "e-1",
        duration_min: "60",
        entry_date: "2026-04-15",
        tz_offset_min: "0",
      }),
    );
    const u = findUpdate();
    expect(u).not.toBeNull();
    expect(u!.patch).toHaveProperty("start_time");
    expect(u!.patch).toHaveProperty("end_time");
    expect(u!.patch).not.toHaveProperty("description");
    expect(u!.patch).not.toHaveProperty("category_id");
    expect(u!.patch).not.toHaveProperty("billable");
  });

  it("explicit start_time + end_time on the form is honored verbatim", async () => {
    await updateTimeEntryAction(
      fd({
        id: "e-1",
        start_time: "2026-04-15T09:00:00.000Z",
        end_time: "2026-04-15T10:00:00.000Z",
      }),
    );
    const u = findUpdate();
    expect(u).not.toBeNull();
    expect(u!.patch.start_time).toBe("2026-04-15T09:00:00.000Z");
    expect(u!.patch.end_time).toBe("2026-04-15T10:00:00.000Z");
  });

  it("empty submit is a no-op (no UPDATE round-trip)", async () => {
    await updateTimeEntryAction(fd({ id: "e-1" }));
    expect(findUpdate()).toBeNull();
  });

  it("billable=on on a non-internal project sets billable=true", async () => {
    state.existingTimeEntry = {
      project_id: "p-1",
      projects: { is_internal: false },
    };
    await updateTimeEntryAction(fd({ id: "e-1", billable: "on" }));
    expect(findUpdate()?.patch.billable).toBe(true);
  });

  it("billable=on on an internal project is forced to billable=false", async () => {
    state.existingTimeEntry = {
      project_id: "p-1",
      projects: { is_internal: true },
    };
    await updateTimeEntryAction(fd({ id: "e-1", billable: "on" }));
    expect(findUpdate()?.patch.billable).toBe(false);
  });

  it("billable absent from the form is NOT written (preserves the existing value)", async () => {
    await updateTimeEntryAction(
      fd({ id: "e-1", duration_min: "30", entry_date: "2026-04-15" }),
    );
    expect(findUpdate()?.patch).not.toHaveProperty("billable");
  });

  it("empty description string is written as null (clears the description)", async () => {
    state.existingTimeEntry = {
      project_id: "p-1",
      projects: { is_internal: false },
    };
    await updateTimeEntryAction(fd({ id: "e-1", description: "" }));
    expect(findUpdate()?.patch.description).toBeNull();
  });

  // Regression — sibling fix for createTimeEntryAction. If the user
  // edits an entry's ticket field but leaves description empty, the
  // inline-edit form posts description="" and ticket_ref="KEY". The
  // resolved ticket title becomes the description so the row stops
  // rendering as "Untitled".
  it("empty description + resolving ticket_ref → patch.description becomes `${key} ${title}`", async () => {
    state.existingTimeEntry = {
      project_id: "p-1",
      projects: { is_internal: false },
    };
    ticketAttachmentMock.mockResolvedValue({
      linked_ticket_provider: "jira",
      linked_ticket_key: "AE-644",
      linked_ticket_url: "https://example.atlassian.net/browse/AE-644",
      linked_ticket_title: "Amplify Gen 2 cutover",
      linked_ticket_refreshed_at: "2026-05-12T15:00:00.000Z",
    });
    await updateTimeEntryAction(
      fd({ id: "e-1", description: "", ticket_ref: "AE-644" }),
    );
    expect(findUpdate()?.patch.description).toBe(
      "AE-644 Amplify Gen 2 cutover",
    );
  });

  it("does NOT auto-fill description when ticket_ref is submitted but description field is absent (preserves whatever's already on the row)", async () => {
    state.existingTimeEntry = {
      project_id: "p-1",
      projects: { is_internal: false },
    };
    ticketAttachmentMock.mockResolvedValue({
      linked_ticket_provider: "jira",
      linked_ticket_key: "AE-644",
      linked_ticket_url: null,
      linked_ticket_title: "Amplify Gen 2 cutover",
      linked_ticket_refreshed_at: "2026-05-12T15:00:00.000Z",
    });
    // Only ticket_ref — no description field at all.
    await updateTimeEntryAction(
      fd({ id: "e-1", ticket_ref: "AE-644" }),
    );
    expect(findUpdate()?.patch).not.toHaveProperty("description");
    // But ticket fields ARE recomputed and written.
    expect(findUpdate()?.patch.linked_ticket_key).toBe("AE-644");
  });
});
