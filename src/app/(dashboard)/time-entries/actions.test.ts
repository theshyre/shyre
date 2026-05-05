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

const state: {
  updates: { table: string; patch: unknown; filters: Filter[] }[];
  deletes: { table: string; filters: Filter[] }[];
  updateError: { message: string } | null;
} = {
  updates: [],
  deletes: [],
  updateError: null,
};

function mockSupabase() {
  return {
    from: (table: string) => {
      if (table !== "time_entries") {
        throw new Error(`unexpected table ${table}`);
      }
      return tableChain(table);
    },
  };
}

/**
 * Chain that records every filter call and resolves once the
 * terminal (`update().<filters>` or `delete().<filters>`) is awaited.
 * The action code uses `assertSupabaseOk(await ...)` which awaits
 * the chain directly — so the chain itself must be a thenable.
 */
function tableChain(table: string) {
  type Op = { kind: "update"; patch: unknown } | { kind: "delete" };
  const op: { current: Op | null; filters: Filter[] } = {
    current: null,
    filters: [],
  };
  const chain: Record<string, unknown> = {
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
    then(resolve: (v: { data: null; error: unknown }) => void) {
      // Record the operation when the chain is awaited.
      if (op.current?.kind === "update") {
        state.updates.push({
          table,
          patch: op.current.patch,
          filters: [...op.filters],
        });
      } else if (op.current?.kind === "delete") {
        state.deletes.push({ table, filters: [...op.filters] });
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
  state.updateError = null;
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
