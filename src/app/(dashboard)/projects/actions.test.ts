import { describe, it, expect, vi, beforeEach } from "vitest";

// Strip the auth wrap — safe-action.test.ts covers it. Tests here
// focus on rate gating: the new setProjectRateAction + the guardrail
// on updateProjectAction's hourly_rate field.
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

// Supabase mock: only the methods these two actions use. RPC returns
// whatever state.canSetProjectRate says; UPDATE records its patch so
// tests can assert on what actually hit the DB.
const state: {
  canSetProjectRate: boolean;
  updates: { table: string; patch: Record<string, unknown>; where: Record<string, string> }[];
  inserts: { table: string; rows: unknown }[];
} = {
  canSetProjectRate: true,
  updates: [],
  inserts: [],
};

function mockSupabase() {
  return {
    rpc: (name: string, _args: unknown) =>
      Promise.resolve({
        data: name === "can_set_project_rate" ? state.canSetProjectRate : null,
        error: null,
      }),
    from: (table: string) => ({
      insert: (rows: unknown) => {
        state.inserts.push({ table, rows });
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          state.updates.push({ table, patch, where: { [col]: val } });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  updateProjectAction,
  setProjectRateAction,
} from "./actions";

function resetState() {
  state.canSetProjectRate = true;
  state.updates = [];
  state.inserts = [];
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updateProjectAction — rate guardrail", () => {
  beforeEach(resetState);

  it("includes hourly_rate in the UPDATE when can_set_project_rate is true", async () => {
    state.canSetProjectRate = true;
    await updateProjectAction(
      fd({
        id: "p1",
        name: "A",
        status: "active",
        hourly_rate: "250",
      }),
    );
    const patch = state.updates.find((u) => u.table === "projects")?.patch;
    expect(patch?.hourly_rate).toBe(250);
  });

  it("drops hourly_rate from the UPDATE when can_set_project_rate is false, but still saves other fields", async () => {
    state.canSetProjectRate = false;
    await updateProjectAction(
      fd({
        id: "p1",
        name: "New name",
        status: "active",
        hourly_rate: "999",
      }),
    );
    const patch = state.updates.find((u) => u.table === "projects")?.patch;
    expect(patch).toBeDefined();
    // Other fields persist.
    expect(patch?.name).toBe("New name");
    expect(patch?.status).toBe("active");
    // Rate is silently dropped.
    expect(patch).not.toHaveProperty("hourly_rate");
  });

  it("does not call the rpc at all when hourly_rate is absent from the form", async () => {
    const rpcSpy = vi.fn();
    // Re-mock to spy on rpc
    state.canSetProjectRate = true;
    await updateProjectAction(
      fd({ id: "p1", name: "A", status: "active" }),
    );
    const patch = state.updates.find((u) => u.table === "projects")?.patch;
    expect(patch).not.toHaveProperty("hourly_rate");
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe("setProjectRateAction", () => {
  beforeEach(resetState);

  it("writes the rate when can_set_project_rate is true", async () => {
    state.canSetProjectRate = true;
    await setProjectRateAction(fd({ id: "p1", hourly_rate: "150" }));
    const u = state.updates.find((x) => x.table === "projects");
    expect(u?.patch).toEqual({ hourly_rate: 150 });
    expect(u?.where).toEqual({ id: "p1" });
  });

  it("writes null when hourly_rate is absent from the form (clears the rate)", async () => {
    state.canSetProjectRate = true;
    await setProjectRateAction(fd({ id: "p1" }));
    const u = state.updates.find((x) => x.table === "projects");
    expect(u?.patch).toEqual({ hourly_rate: null });
  });

  it("throws when can_set_project_rate returns false and does not write", async () => {
    state.canSetProjectRate = false;
    await expect(
      setProjectRateAction(fd({ id: "p1", hourly_rate: "999" })),
    ).rejects.toThrow(/Not authorized to set this project's rate/);
    expect(state.updates).toHaveLength(0);
  });

  it("throws when id is missing", async () => {
    state.canSetProjectRate = true;
    await expect(
      setProjectRateAction(fd({ hourly_rate: "100" })),
    ).rejects.toThrow(/Project id is required/);
    expect(state.updates).toHaveLength(0);
  });
});
