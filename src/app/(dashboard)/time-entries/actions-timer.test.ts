import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Second harness for time-entries actions — covers the timer-shaped
 * exports the base actions.test.ts scoped out: startTimerAction (all
 * three entry modes), duplicateTimeEntryAction,
 * updateTimeEntryDurationAction, permanentlyDeleteTimeEntriesAction,
 * refreshTicketTitleAction and applyTicketTitleAsDescriptionAction.
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
  validateTeamAccess: (...args: unknown[]) => mockValidateTeamAccess(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const ticketAttachmentMock = vi.fn();
vi.mock("@/lib/tickets/attach", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tickets/attach")>(
    "@/lib/tickets/attach",
  );
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

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const state: {
  /** FIFO results per table for .single() / .maybeSingle() reads. */
  rowQueues: Record<string, Result[]>;
  /** FIFO results per table for awaited list selects. */
  listQueues: Record<string, Result[]>;
  updates: { table: string; patch: Record<string, unknown>; filters: Filter[] }[];
  deletes: { table: string; filters: Filter[] }[];
  inserts: { table: string; rows: Record<string, unknown> }[];
} = {
  rowQueues: {},
  listQueues: {},
  updates: [],
  deletes: [],
  inserts: [],
};

function shiftRow(table: string): Result {
  return state.rowQueues[table]?.shift() ?? { data: null, error: null };
}

function mockSupabase() {
  return {
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
          return {
            then: (
              onF: (v: Result) => unknown,
              onR?: (e: unknown) => unknown,
            ): Promise<unknown> =>
              Promise.resolve({ data: null, error: null }).then(onF, onR),
          };
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
        is: (col: string, value: unknown) => {
          op.filters.push({ col, op: "is", value });
          return chain;
        },
        in: (col: string, value: unknown) => {
          op.filters.push({ col, op: "in", value });
          return chain;
        },
        not: (col: string, _o: string, value: unknown) => {
          op.filters.push({ col, op: "not.is", value });
          return chain;
        },
        gte: () => chain,
        lt: () => chain,
        order: () => chain,
        limit: () => chain,
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
  applyTicketTitleAsDescriptionAction,
  duplicateTimeEntryAction,
  permanentlyDeleteTimeEntriesAction,
  refreshTicketTitleAction,
  startTimerAction,
  updateTimeEntryDurationAction,
} from "./actions";

const EMPTY_TICKET = {
  linked_ticket_provider: null,
  linked_ticket_key: null,
  linked_ticket_url: null,
  linked_ticket_title: null,
  linked_ticket_refreshed_at: null,
};

function reset(): void {
  state.rowQueues = {};
  state.listQueues = {};
  state.updates = [];
  state.deletes = [];
  state.inserts = [];
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId });
  mockRevalidatePath.mockReset();
  ticketAttachmentMock.mockReset();
  ticketAttachmentMock.mockResolvedValue({ ...EMPTY_TICKET });
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updateTimeEntryDurationAction", () => {
  beforeEach(reset);

  const ownRow = {
    user_id: fakeUserId,
    start_time: "2026-07-01T10:00:00.000Z",
    invoiced: false,
    invoice_id: null,
  };

  it("recomputes end_time from start_time + minutes, scoped to id + author", async () => {
    state.rowQueues["time_entries"] = [{ data: ownRow, error: null }];
    await updateTimeEntryDurationAction(fd({ id: "e-1", duration_min: "90" }));
    expect(state.updates).toEqual([
      {
        table: "time_entries",
        patch: { end_time: "2026-07-01T11:30:00.000Z" },
        filters: [
          { col: "id", op: "eq", value: "e-1" },
          { col: "user_id", op: "eq", value: fakeUserId },
        ],
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/time-entries");
  });

  it("zero minutes soft-deletes the entry (recoverable via trash)", async () => {
    state.rowQueues["time_entries"] = [{ data: ownRow, error: null }];
    await updateTimeEntryDurationAction(fd({ id: "e-1", duration_min: "0" }));
    expect(state.updates[0]?.patch.deleted_at).toEqual(expect.any(String));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/time-entries/trash");
  });

  it("refuses to edit someone else's entry", async () => {
    state.rowQueues["time_entries"] = [
      { data: { ...ownRow, user_id: "u-other" }, error: null },
    ];
    await expect(
      updateTimeEntryDurationAction(fd({ id: "e-1", duration_min: "60" })),
    ).rejects.toThrow(/author can edit/);
    expect(state.updates).toHaveLength(0);
  });

  it("refuses when the entry is locked on an invoice", async () => {
    state.rowQueues["time_entries"] = [
      { data: { ...ownRow, invoiced: true, invoice_id: "inv-1" }, error: null },
    ];
    await expect(
      updateTimeEntryDurationAction(fd({ id: "e-1", duration_min: "60" })),
    ).rejects.toThrow(/locked/);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects a missing id and a negative / non-numeric duration", async () => {
    await expect(
      updateTimeEntryDurationAction(fd({ duration_min: "60" })),
    ).rejects.toThrow(/Entry id required/);
    await expect(
      updateTimeEntryDurationAction(fd({ id: "e-1", duration_min: "-5" })),
    ).rejects.toThrow(/non-negative/);
    await expect(
      updateTimeEntryDurationAction(fd({ id: "e-1", duration_min: "abc" })),
    ).rejects.toThrow(/non-negative/);
  });

  it("404s on a missing entry and propagates read errors", async () => {
    state.rowQueues["time_entries"] = [{ data: null, error: null }];
    await expect(
      updateTimeEntryDurationAction(fd({ id: "e-x", duration_min: "60" })),
    ).rejects.toThrow(/Entry not found/);

    state.rowQueues["time_entries"] = [
      { data: null, error: { message: "boom", code: "42501" } },
    ];
    await expect(
      updateTimeEntryDurationAction(fd({ id: "e-1", duration_min: "60" })),
    ).rejects.toThrow();
  });
});

describe("permanentlyDeleteTimeEntriesAction", () => {
  beforeEach(reset);

  it("hard-deletes only the caller's trashed rows", async () => {
    const f = new FormData();
    f.append("id", "e-1");
    f.append("id", "e-2");
    await permanentlyDeleteTimeEntriesAction(f);
    expect(state.deletes).toEqual([
      {
        table: "time_entries",
        filters: [
          { col: "id", op: "in", value: ["e-1", "e-2"] },
          { col: "user_id", op: "eq", value: fakeUserId },
          { col: "deleted_at", op: "not.is", value: null },
        ],
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/time-entries/trash");
  });

  it("no-ops on an empty selection", async () => {
    await permanentlyDeleteTimeEntriesAction(new FormData());
    expect(state.deletes).toHaveLength(0);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("startTimerAction — fresh start", () => {
  beforeEach(reset);

  const project = {
    team_id: "t-1",
    is_internal: false,
    default_billable: true,
  };

  it("stops any running timer, then inserts a new running entry with the project's team + billable default", async () => {
    state.rowQueues["projects"] = [{ data: project, error: null }];
    await startTimerAction(
      fd({ project_id: "p-1", description: "Deep work", force_new: "1" }),
    );

    // First write: the stop-running sweep on the caller's open rows.
    expect(state.updates[0]).toMatchObject({
      table: "time_entries",
      patch: { end_time: expect.any(String) },
    });
    expect(state.updates[0]?.filters).toEqual([
      { col: "user_id", op: "eq", value: fakeUserId },
      { col: "end_time", op: "is", value: null },
      { col: "deleted_at", op: "is", value: null },
    ]);

    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.rows).toMatchObject({
      team_id: "t-1",
      user_id: fakeUserId,
      project_id: "p-1",
      description: "Deep work",
      end_time: null,
      billable: true,
    });
    expect(mockValidateTeamAccess).toHaveBeenCalledWith("t-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/time-entries");
  });

  it("pins billable=false on internal projects regardless of default", async () => {
    state.rowQueues["projects"] = [
      { data: { ...project, is_internal: true }, error: null },
    ];
    await startTimerAction(fd({ project_id: "p-1", force_new: "1" }));
    expect(state.inserts[0]?.rows.billable).toBe(false);
  });

  it("resumes a completed same-day entry by backdating its start", async () => {
    state.rowQueues["projects"] = [{ data: project, error: null }];
    state.listQueues["time_entries"] = [
      {
        data: [{ id: "e-today", duration_min: 45, description: "Morning" }],
        error: null,
      },
    ];
    const before = Date.now();
    await startTimerAction(fd({ project_id: "p-1" }));

    // No new row — the existing entry is reopened.
    expect(state.inserts).toHaveLength(0);
    const resume = state.updates[1];
    expect(resume?.filters).toContainEqual({
      col: "id",
      op: "eq",
      value: "e-today",
    });
    expect(resume?.patch.end_time).toBeNull();
    // start_time backdated by the accumulated 45 minutes.
    const backdated = new Date(resume?.patch.start_time as string).getTime();
    expect(before - backdated).toBeGreaterThanOrEqual(45 * 60_000 - 5_000);
    expect(before - backdated).toBeLessThan(45 * 60_000 + 5_000);
    // No description supplied → existing note left intact.
    expect(resume?.patch).not.toHaveProperty("description");
  });

  it("force_new skips the resume lookup entirely", async () => {
    state.rowQueues["projects"] = [{ data: project, error: null }];
    state.listQueues["time_entries"] = [
      {
        data: [{ id: "e-today", duration_min: 45, description: "Morning" }],
        error: null,
      },
    ];
    await startTimerAction(fd({ project_id: "p-1", force_new: "1" }));
    // The same-day entry was ignored — a fresh row was inserted.
    expect(state.inserts).toHaveLength(1);
  });

  it("errors when the project is missing / inaccessible", async () => {
    state.rowQueues["projects"] = [
      { data: null, error: { message: "0 rows", code: "PGRST116" } },
    ];
    await expect(
      startTimerAction(fd({ project_id: "p-x", force_new: "1" })),
    ).rejects.toThrow(/Project not found/);
    expect(state.inserts).toHaveLength(0);
  });

  it("requires a project (or an explicit resume target)", async () => {
    await expect(startTimerAction(fd({}))).rejects.toThrow(
      /project_id is required/,
    );
  });
});

describe("startTimerAction — per-entry resume", () => {
  beforeEach(reset);

  const source = {
    user_id: fakeUserId,
    team_id: "t-1",
    project_id: "p-1",
    category_id: "cat-1",
    description: "AE-640 Fix login",
    billable: true,
    duration_min: 30,
    start_time: new Date().toISOString(),
    linked_ticket_provider: "jira",
    linked_ticket_key: "AE-640",
    linked_ticket_url: "https://jira.test/AE-640",
    linked_ticket_title: "Fix login",
    linked_ticket_refreshed_at: "2026-07-01T00:00:00Z",
    projects: { is_internal: false },
  };

  it("resumes a same-day entry in place (backdated start, cleared end)", async () => {
    state.rowQueues["time_entries"] = [{ data: source, error: null }];
    await startTimerAction(fd({ resume_entry_id: "e-1" }));
    // updates[0] is the stop-running sweep; updates[1] the resume.
    const resume = state.updates[1];
    expect(resume?.filters).toContainEqual({
      col: "id",
      op: "eq",
      value: "e-1",
    });
    expect(resume?.patch.end_time).toBeNull();
    expect(state.inserts).toHaveLength(0);
  });

  it("clones the entry onto today when the source lives on another day", async () => {
    state.rowQueues["time_entries"] = [
      {
        data: { ...source, start_time: "2026-07-10T09:00:00.000Z" },
        error: null,
      },
    ];
    await startTimerAction(fd({ resume_entry_id: "e-1" }));
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.rows).toMatchObject({
      team_id: "t-1",
      project_id: "p-1",
      category_id: "cat-1",
      description: "AE-640 Fix login",
      billable: true,
      end_time: null,
      linked_ticket_key: "AE-640",
    });
  });

  it("the clone pins billable=false when the project is internal", async () => {
    state.rowQueues["time_entries"] = [
      {
        data: {
          ...source,
          start_time: "2026-07-10T09:00:00.000Z",
          projects: { is_internal: true },
        },
        error: null,
      },
    ];
    await startTimerAction(fd({ resume_entry_id: "e-1" }));
    expect(state.inserts[0]?.rows.billable).toBe(false);
  });

  it("only the author can resume an entry", async () => {
    state.rowQueues["time_entries"] = [
      { data: { ...source, user_id: "u-other" }, error: null },
    ];
    await expect(
      startTimerAction(fd({ resume_entry_id: "e-1" })),
    ).rejects.toThrow(/author can resume/);
    expect(state.updates).toHaveLength(0);
  });

  it("errors when the source entry is gone", async () => {
    state.rowQueues["time_entries"] = [{ data: null, error: null }];
    await expect(
      startTimerAction(fd({ resume_entry_id: "e-x" })),
    ).rejects.toThrow(/Entry not found/);
  });
});

describe("duplicateTimeEntryAction", () => {
  beforeEach(reset);

  const source = {
    team_id: "t-1",
    project_id: "p-1",
    description: "Refactor",
    billable: true,
    github_issue: 42,
    category_id: "cat-1",
    linked_ticket_provider: "github",
    linked_ticket_key: "#42",
    linked_ticket_url: "https://github.test/42",
    linked_ticket_title: "Refactor auth",
    linked_ticket_refreshed_at: null,
  };

  it("stops the running timer and inserts a running copy with ticket fields", async () => {
    state.rowQueues["time_entries"] = [{ data: source, error: null }];
    state.rowQueues["projects"] = [
      { data: { is_internal: false }, error: null },
    ];
    await duplicateTimeEntryAction(fd({ id: "e-1" }));

    expect(state.updates[0]?.patch).toMatchObject({
      end_time: expect.any(String),
    });
    expect(state.inserts[0]?.rows).toMatchObject({
      team_id: "t-1",
      user_id: fakeUserId,
      project_id: "p-1",
      description: "Refactor",
      billable: true,
      github_issue: 42,
      end_time: null,
      linked_ticket_key: "#42",
      linked_ticket_title: "Refactor auth",
    });
  });

  it("re-reads the project's classification — a now-internal project pins the copy to non-billable", async () => {
    state.rowQueues["time_entries"] = [{ data: source, error: null }];
    state.rowQueues["projects"] = [{ data: { is_internal: true }, error: null }];
    await duplicateTimeEntryAction(fd({ id: "e-1" }));
    expect(state.inserts[0]?.rows.billable).toBe(false);
  });

  it("propagates a fetch failure without inserting", async () => {
    state.rowQueues["time_entries"] = [
      { data: null, error: { message: "0 rows", code: "PGRST116" } },
    ];
    await expect(duplicateTimeEntryAction(fd({ id: "e-x" }))).rejects.toThrow();
    expect(state.inserts).toHaveLength(0);
  });
});

describe("refreshTicketTitleAction", () => {
  beforeEach(reset);

  const row = {
    user_id: fakeUserId,
    project_id: "p-1",
    linked_ticket_provider: "jira",
    linked_ticket_key: "AE-640",
  };

  const freshAttachment = {
    linked_ticket_provider: "jira",
    linked_ticket_key: "AE-640",
    linked_ticket_url: "https://jira.test/AE-640",
    linked_ticket_title: "New title",
    linked_ticket_refreshed_at: "2026-07-18T00:00:00Z",
  };

  it("writes the refreshed attachment scoped to id + author", async () => {
    state.rowQueues["time_entries"] = [{ data: row, error: null }];
    ticketAttachmentMock.mockResolvedValue(freshAttachment);
    await refreshTicketTitleAction(fd({ id: "e-1" }));
    expect(state.updates).toEqual([
      {
        table: "time_entries",
        patch: freshAttachment,
        filters: [
          { col: "id", op: "eq", value: "e-1" },
          { col: "user_id", op: "eq", value: fakeUserId },
        ],
      },
    ]);
  });

  it("bails without writing when detection resolves nothing", async () => {
    state.rowQueues["time_entries"] = [{ data: row, error: null }];
    ticketAttachmentMock.mockResolvedValue({ ...EMPTY_TICKET });
    await refreshTicketTitleAction(fd({ id: "e-1" }));
    expect(state.updates).toHaveLength(0);
  });

  it("author-only + linked-ticket-only guards", async () => {
    state.rowQueues["time_entries"] = [
      { data: { ...row, user_id: "u-other" }, error: null },
    ];
    await expect(refreshTicketTitleAction(fd({ id: "e-1" }))).rejects.toThrow(
      /author can refresh/,
    );

    state.rowQueues["time_entries"] = [
      { data: { ...row, linked_ticket_provider: null }, error: null },
    ];
    await expect(refreshTicketTitleAction(fd({ id: "e-1" }))).rejects.toThrow(
      /no linked ticket/,
    );

    await expect(refreshTicketTitleAction(fd({}))).rejects.toThrow(
      /Entry id required/,
    );
  });
});

describe("applyTicketTitleAsDescriptionAction", () => {
  beforeEach(reset);

  const rowWithTitle = {
    user_id: fakeUserId,
    project_id: "p-1",
    linked_ticket_provider: "jira",
    linked_ticket_key: "AE-640",
    linked_ticket_title: "Fix login bug",
  };

  it("syncs description to '<key> <title>' from the cached title", async () => {
    state.rowQueues["time_entries"] = [{ data: rowWithTitle, error: null }];
    await applyTicketTitleAsDescriptionAction(fd({ id: "e-1" }));
    expect(state.updates).toEqual([
      {
        table: "time_entries",
        patch: { description: "AE-640 Fix login bug" },
        filters: [
          { col: "id", op: "eq", value: "e-1" },
          { col: "user_id", op: "eq", value: fakeUserId },
        ],
      },
    ]);
    expect(ticketAttachmentMock).not.toHaveBeenCalled();
  });

  it("refreshes first when no title is cached, persisting attachment + description together", async () => {
    state.rowQueues["time_entries"] = [
      { data: { ...rowWithTitle, linked_ticket_title: null }, error: null },
    ];
    ticketAttachmentMock.mockResolvedValue({
      linked_ticket_provider: "jira",
      linked_ticket_key: "AE-640",
      linked_ticket_url: "https://jira.test/AE-640",
      linked_ticket_title: "Resolved title",
      linked_ticket_refreshed_at: "2026-07-18T00:00:00Z",
    });
    await applyTicketTitleAsDescriptionAction(fd({ id: "e-1" }));
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.patch).toMatchObject({
      description: "AE-640 Resolved title",
      linked_ticket_title: "Resolved title",
    });
  });

  it("errors when the refresh cannot resolve a title", async () => {
    state.rowQueues["time_entries"] = [
      { data: { ...rowWithTitle, linked_ticket_title: null }, error: null },
    ];
    ticketAttachmentMock.mockResolvedValue({ ...EMPTY_TICKET });
    await expect(
      applyTicketTitleAsDescriptionAction(fd({ id: "e-1" })),
    ).rejects.toThrow(/Could not resolve ticket title/);
    expect(state.updates).toHaveLength(0);
  });

  it("author-only + linked-ticket-only guards", async () => {
    state.rowQueues["time_entries"] = [
      { data: { ...rowWithTitle, user_id: "u-other" }, error: null },
    ];
    await expect(
      applyTicketTitleAsDescriptionAction(fd({ id: "e-1" })),
    ).rejects.toThrow(/author can sync/);

    state.rowQueues["time_entries"] = [
      { data: { ...rowWithTitle, linked_ticket_key: null }, error: null },
    ];
    await expect(
      applyTicketTitleAsDescriptionAction(fd({ id: "e-1" })),
    ).rejects.toThrow(/no linked ticket/);
  });
});
