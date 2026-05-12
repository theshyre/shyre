import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * resolveErrorAction is the minimal admin-side mutation: stamp
 * resolved_at + resolved_by on an error_logs row. The action does NOT
 * use runSafeAction — it bare-throws — so the test mocks `createClient`
 * and `requireSystemAdmin` directly.
 *
 * Coverage:
 *   - happy path stamps the row with now + actor + matching id
 *   - sysadmin gate (requireSystemAdmin throws → action throws)
 *   - DB error propagates verbatim
 *   - revalidatePath fires on success
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
      const op: { current: "update" | null; patch: unknown; filters: Filter[] } =
        { current: null, patch: null, filters: [] };
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

import { resolveErrorAction } from "./actions";

function reset(): void {
  state.updates = [];
  state.updateError = null;
  mockRequireSystemAdmin.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("resolveErrorAction", () => {
  beforeEach(reset);

  it("stamps resolved_at + resolved_by on the matching error_logs row", async () => {
    mockRequireSystemAdmin.mockResolvedValue({ userId: fakeUserId });
    const before = Date.now();
    await resolveErrorAction(fd({ error_id: "err-123" }));
    const after = Date.now();

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.table).toBe("error_logs");
    expect(state.updates[0]?.filters).toEqual([
      { col: "id", op: "eq", value: "err-123" },
    ]);
    const patch = state.updates[0]?.patch as {
      resolved_at: string;
      resolved_by: string;
    };
    expect(patch.resolved_by).toBe(fakeUserId);
    // resolved_at is an ISO string close to now.
    const stampedMs = new Date(patch.resolved_at).getTime();
    expect(stampedMs).toBeGreaterThanOrEqual(before);
    expect(stampedMs).toBeLessThanOrEqual(after);
  });

  it("propagates the sysadmin-gate rejection from requireSystemAdmin", async () => {
    mockRequireSystemAdmin.mockRejectedValue(
      new Error("System admin access required."),
    );
    await expect(
      resolveErrorAction(fd({ error_id: "err-123" })),
    ).rejects.toThrow(/System admin/);
    expect(state.updates).toHaveLength(0);
  });

  it("propagates DB errors verbatim", async () => {
    mockRequireSystemAdmin.mockResolvedValue({ userId: fakeUserId });
    state.updateError = { message: "RLS rejected the update" };
    await expect(
      resolveErrorAction(fd({ error_id: "err-123" })),
    ).rejects.toThrow(/RLS rejected/);
  });

  it("revalidates /system/errors on success so the page refreshes", async () => {
    mockRequireSystemAdmin.mockResolvedValue({ userId: fakeUserId });
    await resolveErrorAction(fd({ error_id: "err-1" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/system/errors");
  });

  it("does NOT revalidate when the gate rejects", async () => {
    mockRequireSystemAdmin.mockRejectedValue(new Error("nope"));
    await expect(
      resolveErrorAction(fd({ error_id: "err-1" })),
    ).rejects.toThrow();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
