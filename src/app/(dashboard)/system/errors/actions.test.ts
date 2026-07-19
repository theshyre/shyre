import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Admin-side error_logs mutations. Neither action goes through
 * runSafeAction — they bare-throw — so tests mock `createClient` and
 * `requireSystemAdmin` directly.
 *
 * Coverage:
 *   - resolveErrorGroupAction: stamps only the listed ids AND only
 *     still-unresolved rows; sysadmin gate; empty-ids validation;
 *     DB errors propagate; revalidate on success only.
 *   - resolveAllErrorsAction: unresolved-only sweep; severity scoping;
 *     unknown severity rejected (no accidental resolve-everything);
 *     sysadmin gate; revalidate on success only.
 */

const fakeUserId = "u-sysadmin";

const mockRequireSystemAdmin = vi.fn();
vi.mock("@/lib/system-admin", () => ({
  requireSystemAdmin: () => mockRequireSystemAdmin(),
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
  updates: { table: string; patch: unknown; filters: Filter[] }[];
  updateError: { message: string } | null;
} = {
  updates: [],
  updateError: null,
};

function mockSupabase() {
  return {
    from: (table: string) => {
      const op: {
        current: "update" | null;
        patch: unknown;
        filters: Filter[];
      } = { current: null, patch: null, filters: [] };
      const chain: Record<string, unknown> = {
        update(patch: unknown) {
          op.current = "update";
          op.patch = patch;
          return chain;
        },
        eq(col: string, value: unknown) {
          op.filters.push({ col, op: "eq", value });
          return chain;
        },
        in(col: string, value: unknown) {
          op.filters.push({ col, op: "in", value });
          return chain;
        },
        is(col: string, value: unknown) {
          op.filters.push({ col, op: "is", value });
          return chain;
        },
        then(resolve: (v: { data: null; error: unknown }) => void) {
          if (op.current === "update") {
            state.updates.push({
              table,
              patch: op.patch,
              filters: [...op.filters],
            });
          }
          resolve({ data: null, error: state.updateError });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import { resolveErrorGroupAction, resolveAllErrorsAction } from "./actions";

function reset(): void {
  state.updates = [];
  state.updateError = null;
  mockRequireSystemAdmin.mockReset();
  mockRevalidatePath.mockReset();
  mockRequireSystemAdmin.mockResolvedValue({ userId: fakeUserId });
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function expectFreshStamp(
  patch: unknown,
  before: number,
  after: number,
): void {
  const p = patch as { resolved_at: string; resolved_by: string };
  expect(p.resolved_by).toBe(fakeUserId);
  const stampedMs = new Date(p.resolved_at).getTime();
  expect(stampedMs).toBeGreaterThanOrEqual(before);
  expect(stampedMs).toBeLessThanOrEqual(after);
}

describe("resolveErrorGroupAction", () => {
  beforeEach(reset);

  it("stamps resolved_at + resolved_by on the listed ids, unresolved rows only", async () => {
    const before = Date.now();
    await resolveErrorGroupAction(fd({ error_ids: "err-1, err-2 ,err-3" }));
    const after = Date.now();

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.table).toBe("error_logs");
    expect(state.updates[0]?.filters).toEqual([
      { col: "id", op: "in", value: ["err-1", "err-2", "err-3"] },
      { col: "resolved_at", op: "is", value: null },
    ]);
    expectFreshStamp(state.updates[0]?.patch, before, after);
  });

  it("rejects an empty / missing id list instead of issuing an unfiltered update", async () => {
    await expect(resolveErrorGroupAction(fd({}))).rejects.toThrow(
      /error_ids/,
    );
    await expect(
      resolveErrorGroupAction(fd({ error_ids: " , ," })),
    ).rejects.toThrow(/error_ids/);
    expect(state.updates).toHaveLength(0);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("propagates the sysadmin-gate rejection and touches nothing", async () => {
    mockRequireSystemAdmin.mockRejectedValue(
      new Error("System admin access required."),
    );
    await expect(
      resolveErrorGroupAction(fd({ error_ids: "err-1" })),
    ).rejects.toThrow(/System admin/);
    expect(state.updates).toHaveLength(0);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("propagates DB errors verbatim", async () => {
    state.updateError = { message: "RLS rejected the update" };
    await expect(
      resolveErrorGroupAction(fd({ error_ids: "err-1" })),
    ).rejects.toThrow(/RLS rejected/);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates /system/errors on success", async () => {
    await resolveErrorGroupAction(fd({ error_ids: "err-1" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/system/errors");
  });
});

describe("resolveAllErrorsAction", () => {
  beforeEach(reset);

  it("with severity=all sweeps every unresolved row (single is-null filter)", async () => {
    const before = Date.now();
    await resolveAllErrorsAction(fd({ severity: "all" }));
    const after = Date.now();

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.table).toBe("error_logs");
    expect(state.updates[0]?.filters).toEqual([
      { col: "resolved_at", op: "is", value: null },
    ]);
    expectFreshStamp(state.updates[0]?.patch, before, after);
  });

  it("missing severity behaves like 'all' (unscoped unresolved sweep)", async () => {
    await resolveAllErrorsAction(fd({}));
    expect(state.updates[0]?.filters).toEqual([
      { col: "resolved_at", op: "is", value: null },
    ]);
  });

  it("scopes the sweep with eq(severity) when a severity is given", async () => {
    await resolveAllErrorsAction(fd({ severity: "warning" }));
    expect(state.updates[0]?.filters).toEqual([
      { col: "resolved_at", op: "is", value: null },
      { col: "severity", op: "eq", value: "warning" },
    ]);
  });

  it("rejects an unknown severity — a typo must not widen the sweep", async () => {
    await expect(
      resolveAllErrorsAction(fd({ severity: "everything" })),
    ).rejects.toThrow(/severity/i);
    expect(state.updates).toHaveLength(0);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("propagates the sysadmin-gate rejection and touches nothing", async () => {
    mockRequireSystemAdmin.mockRejectedValue(new Error("nope"));
    await expect(resolveAllErrorsAction(fd({ severity: "all" }))).rejects.toThrow(
      /nope/,
    );
    expect(state.updates).toHaveLength(0);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("propagates DB errors and skips revalidate", async () => {
    state.updateError = { message: "boom" };
    await expect(resolveAllErrorsAction(fd({ severity: "all" }))).rejects.toThrow(
      /boom/,
    );
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates /system/errors on success", async () => {
    await resolveAllErrorsAction(fd({ severity: "error" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/system/errors");
  });
});
