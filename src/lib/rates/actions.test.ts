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
  validateTeamAccess: (...args: unknown[]) => mockValidateTeamAccess(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const state: {
  canSetRatePermissions: boolean;
  teamIdByObject: Map<string, string>; // e.g. "project:p1" -> "team-x"
  updates: { table: string; patch: Record<string, unknown>; where: Record<string, string> }[];
  upserts: { table: string; rows: unknown }[];
} = {
  canSetRatePermissions: true,
  teamIdByObject: new Map(),
  updates: [],
  upserts: [],
};

function mockSupabase() {
  return {
    rpc: (_name: string, _args: unknown) =>
      Promise.resolve({
        data: state.canSetRatePermissions,
        error: null,
      }),
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, val: string) => ({
          single: () => {
            const teamId = state.teamIdByObject.get(`${table}:${val}`);
            return Promise.resolve({
              data: teamId ? { team_id: teamId } : null,
            });
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          state.updates.push({ table, patch, where: { [col]: val } });
          return Promise.resolve({ data: null, error: null });
        },
      }),
      upsert: (rows: unknown) => {
        state.upserts.push({ table, rows });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  toggleRatePermissionDelegationAction,
  setRateVisibilityAction,
  setRateEditabilityAction,
} from "./actions";

function resetState() {
  state.canSetRatePermissions = true;
  state.teamIdByObject = new Map();
  state.updates = [];
  state.upserts = [];
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("toggleRatePermissionDelegationAction", () => {
  beforeEach(resetState);

  it("owner can flip the flag on", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await toggleRatePermissionDelegationAction(
      fd({ team_id: "team-1", enabled: "true" }),
    );
    const up = state.upserts.find((x) => x.table === "team_settings");
    expect(up?.rows).toEqual({
      team_id: "team-1",
      admins_can_set_rate_permissions: true,
    });
  });

  it("owner can flip the flag off", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await toggleRatePermissionDelegationAction(
      fd({ team_id: "team-1", enabled: "false" }),
    );
    const up = state.upserts.find((x) => x.table === "team_settings");
    expect(up?.rows).toEqual({
      team_id: "team-1",
      admins_can_set_rate_permissions: false,
    });
  });

  it("admin is rejected — cannot self-delegate", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    await expect(
      toggleRatePermissionDelegationAction(
        fd({ team_id: "team-1", enabled: "true" }),
      ),
    ).rejects.toThrow(/Only the owner can delegate/);
    expect(state.upserts).toHaveLength(0);
  });

  it("member is rejected", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      toggleRatePermissionDelegationAction(
        fd({ team_id: "team-1", enabled: "true" }),
      ),
    ).rejects.toThrow(/Only the owner can delegate/);
  });

  it("throws when team_id is missing", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await expect(
      toggleRatePermissionDelegationAction(fd({ enabled: "true" })),
    ).rejects.toThrow(/team_id is required/);
  });
});

describe("setRateVisibilityAction", () => {
  beforeEach(resetState);

  it("updates rate_visibility on a project when authorized", async () => {
    state.canSetRatePermissions = true;
    state.teamIdByObject.set("projects:p1", "team-x");
    await setRateVisibilityAction(
      fd({ object_type: "project", object_id: "p1", level: "admins" }),
    );
    const u = state.updates.find((x) => x.table === "projects");
    expect(u?.patch).toEqual({ rate_visibility: "admins" });
    expect(u?.where).toEqual({ id: "p1" });
  });

  it("updates rate_visibility on team_settings (keyed by team_id)", async () => {
    state.canSetRatePermissions = true;
    await setRateVisibilityAction(
      fd({ object_type: "team", object_id: "team-x", level: "all_members" }),
    );
    const u = state.updates.find((x) => x.table === "team_settings");
    expect(u?.patch).toEqual({ rate_visibility: "all_members" });
    expect(u?.where).toEqual({ team_id: "team-x" });
  });

  it("accepts the 'self' level only for member, not for the 3-level tables", async () => {
    state.canSetRatePermissions = true;
    state.teamIdByObject.set("team_members:m1", "team-x");
    await setRateVisibilityAction(
      fd({ object_type: "member", object_id: "m1", level: "self" }),
    );
    expect(
      state.updates.find((x) => x.table === "team_members")?.patch,
    ).toEqual({ rate_visibility: "self" });

    // Now try 'self' on a project — must be rejected.
    state.updates = [];
    state.teamIdByObject.set("projects:p1", "team-x");
    await expect(
      setRateVisibilityAction(
        fd({ object_type: "project", object_id: "p1", level: "self" }),
      ),
    ).rejects.toThrow(/Invalid level "self" for project/);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects unknown levels", async () => {
    state.canSetRatePermissions = true;
    state.teamIdByObject.set("projects:p1", "team-x");
    await expect(
      setRateVisibilityAction(
        fd({ object_type: "project", object_id: "p1", level: "everyone" }),
      ),
    ).rejects.toThrow(/Invalid level "everyone"/);
  });

  it("throws when can_set_rate_permissions returns false", async () => {
    state.canSetRatePermissions = false;
    state.teamIdByObject.set("projects:p1", "team-x");
    await expect(
      setRateVisibilityAction(
        fd({ object_type: "project", object_id: "p1", level: "admins" }),
      ),
    ).rejects.toThrow(/Not authorized to change rate permissions/);
    expect(state.updates).toHaveLength(0);
  });

  it("throws when the object cannot be resolved to a team", async () => {
    state.canSetRatePermissions = true;
    // Don't populate teamIdByObject → single() returns null
    await expect(
      setRateVisibilityAction(
        fd({ object_type: "project", object_id: "ghost", level: "admins" }),
      ),
    ).rejects.toThrow(/Object project:ghost not found/);
  });

  it("throws when required fields are missing", async () => {
    await expect(
      setRateVisibilityAction(
        fd({ object_type: "project", object_id: "p1" }),
      ),
    ).rejects.toThrow(/object_type, object_id, and level are required/);
  });
});

describe("setRateEditabilityAction", () => {
  beforeEach(resetState);

  it("updates rate_editability with the same gating as visibility", async () => {
    state.canSetRatePermissions = true;
    state.teamIdByObject.set("customers:c1", "team-x");
    await setRateEditabilityAction(
      fd({ object_type: "customer", object_id: "c1", level: "admins" }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch).toEqual({ rate_editability: "admins" });
  });

  it("honors can_set_rate_permissions=false", async () => {
    state.canSetRatePermissions = false;
    state.teamIdByObject.set("customers:c1", "team-x");
    await expect(
      setRateEditabilityAction(
        fd({ object_type: "customer", object_id: "c1", level: "admins" }),
      ),
    ).rejects.toThrow(/Not authorized/);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects 'self' on a non-member object", async () => {
    state.canSetRatePermissions = true;
    state.teamIdByObject.set("customers:c1", "team-x");
    await expect(
      setRateEditabilityAction(
        fd({ object_type: "customer", object_id: "c1", level: "self" }),
      ),
    ).rejects.toThrow(/Invalid level "self" for customer/);
  });
});
