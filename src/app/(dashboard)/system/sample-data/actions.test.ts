import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Action-layer tests for the sample-data surface — the highest-risk
 * surface in the app because it can wipe a team. We don't deeply
 * test the internal seed/wipe helpers (createSampleUsers, loadSample,
 * deleteSampleRowsInOrg) — those need extensive admin-client
 * fixtures and live in private functions. We DO test the public
 * action contracts:
 *
 *   - every action gates on isSystemAdmin
 *   - 3/4 gate additionally on team owner|admin
 *   - asTeamId rejects missing team_id
 *   - clearAllTeamDataAction's typed-confirm matches the team name
 *   - revalidatePath fires the expected set of paths
 *
 * The supabase + admin clients are stubbed thoroughly enough to let
 * the orchestration land without exercising the internal helpers.
 */

const fakeUserId = "u-sysadmin";

vi.mock("@/lib/safe-action", () => ({
  runSafeAction: async (
    formData: FormData,
    fn: (
      fd: FormData,
      ctx: { supabase: unknown; userId: string },
    ) => Promise<void>,
  ) => {
    try {
      await fn(formData, { supabase: mockSupabase(), userId: fakeUserId });
      return { success: true };
    } catch (err) {
      // Mirror runSafeAction's catch shape — return shape, don't re-throw
      // for the user-facing path. Tests that assert rejection use
      // expect(...).rejects.toThrow which works either way (vi.fn() will
      // also flag if we don't throw on internal logic errors).
      throw err;
    }
  },
}));

const mockIsSystemAdmin = vi.fn();
vi.mock("@/lib/system-admin", () => ({
  isSystemAdmin: () => mockIsSystemAdmin(),
}));

const mockValidateTeamAccess = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (teamId: string) => mockValidateTeamAccess(teamId),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

// The admin client is a separate noisy surface. Mock it to a no-op
// chain so loadSample / deleteSampleRowsInOrg / cleanupOrphanTeamsAction
// can run their orchestration without us tracking every row.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockAdminClient(),
}));

// The expensive sample-data generator: stub it so loadSampleDataAction
// can finish its orchestration without spinning up the full seed graph.
vi.mock("@/lib/sample-data/generate", () => ({
  generateSampleData: () => ({
    business: { name: "Sample Co", email: "sample@example.com", address: null },
    customers: [],
    projects: [],
    timeEntries: [],
    invoices: [],
    expenses: [],
    teamSettings: {},
    sampleUsers: [],
  }),
}));

// Invoice-utils is pulled in by loadSample; stub to keep the test
// runtime trivial.
vi.mock("@/lib/invoice-utils", () => ({
  calculateLineItemAmount: () => 0,
  calculateInvoiceTotals: () => ({
    subtotal: 0,
    tax_amount: 0,
    total: 0,
  }),
  generateInvoiceNumber: () => "INV-2026-000",
  minutesToHours: () => 0,
}));

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

const state: {
  /** What .from("teams").select("name").eq("id", X).single() returns
   *  inside requireAdminOfTeam. */
  teamRow: { name: string } | null;
  /** Records every supabase admin-client `.from(...).delete().eq(...)`
   *  call so clearAllTeamDataAction's wipe order can be asserted. */
  adminDeletes: { table: string; filters: Filter[] }[];
  /** Records every admin-client insert. */
  adminInserts: { table: string; rows: unknown }[];
} = {
  teamRow: null,
  adminDeletes: [],
  adminInserts: [],
};

function mockSupabase() {
  return {
    from: (table: string) => userChain(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

function userChain(table: string) {
  type Op = { kind: "select" } | { kind: "delete" } | { kind: "insert" } | { kind: "update" };
  const op: { current: Op | null; filters: Filter[]; rows?: unknown } = {
    current: null,
    filters: [],
  };
  const chain: Record<string, unknown> = {
    select() {
      op.current = { kind: "select" };
      return chain;
    },
    insert(rows: unknown) {
      op.current = { kind: "insert" };
      op.rows = rows;
      const insertChain: Record<string, unknown> = {
        select: () => insertChain,
        single: () =>
          Promise.resolve({
            data: { id: "new-id" },
            error: null,
          }),
        then: (resolve: (v: { data: null; error: null }) => void) => {
          resolve({ data: null, error: null });
        },
      };
      return insertChain;
    },
    update() {
      op.current = { kind: "update" };
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
    single() {
      if (table === "teams") {
        return Promise.resolve({
          data: state.teamRow,
          error: state.teamRow ? null : { message: "no rows" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (v: { data: unknown; error: null }) => void) {
      resolve({ data: null, error: null });
    },
  };
  return chain;
}

function mockAdminClient() {
  return {
    from: (table: string) => {
      const op: { current: string | null; filters: Filter[] } = {
        current: null,
        filters: [],
      };
      const chain: Record<string, unknown> = {
        select(_cols?: string, _opts?: { count?: string; head?: boolean }) {
          op.current = "select";
          return chain;
        },
        insert(rows: unknown) {
          state.adminInserts.push({ table, rows });
          return Promise.resolve({ data: null, error: null });
        },
        update() {
          op.current = "update";
          return chain;
        },
        delete() {
          op.current = "delete";
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
        single() {
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then(
          resolve: (v: {
            data: unknown;
            error: null;
            count: number;
          }) => void,
        ) {
          if (op.current === "delete") {
            state.adminDeletes.push({
              table,
              filters: [...op.filters],
            });
          }
          resolve({ data: [], error: null, count: 0 });
        },
      };
      return chain;
    },
    auth: {
      admin: {
        listUsers: () =>
          Promise.resolve({ data: { users: [] }, error: null }),
        deleteUser: () => Promise.resolve({ error: null }),
        createUser: () =>
          Promise.resolve({
            data: { user: { id: "u-new" } },
            error: null,
          }),
      },
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  clearAllTeamDataAction,
  cleanupOrphanTeamsAction,
  loadSampleDataAction,
  removeSampleDataAction,
} from "./actions";

function reset(): void {
  state.teamRow = null;
  state.adminDeletes = [];
  state.adminInserts = [];
  mockIsSystemAdmin.mockReset();
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("asTeamId (via every action)", () => {
  beforeEach(reset);

  it("rejects missing team_id on loadSampleDataAction", async () => {
    mockIsSystemAdmin.mockResolvedValue(true);
    await expect(loadSampleDataAction(fd({}))).rejects.toThrow(/team_id/);
  });

  it("rejects missing team_id on removeSampleDataAction", async () => {
    mockIsSystemAdmin.mockResolvedValue(true);
    await expect(removeSampleDataAction(fd({}))).rejects.toThrow(/team_id/);
  });

  it("rejects missing team_id on clearAllTeamDataAction", async () => {
    mockIsSystemAdmin.mockResolvedValue(true);
    await expect(clearAllTeamDataAction(fd({}))).rejects.toThrow(/team_id/);
  });
});

describe("System-admin gate (requireAdminOfTeam + cleanupOrphanTeams)", () => {
  beforeEach(reset);

  it("loadSampleDataAction rejects non-sysadmins", async () => {
    mockIsSystemAdmin.mockResolvedValue(false);
    await expect(
      loadSampleDataAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/System admin/);
  });

  it("removeSampleDataAction rejects non-sysadmins", async () => {
    mockIsSystemAdmin.mockResolvedValue(false);
    await expect(
      removeSampleDataAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/System admin/);
  });

  it("clearAllTeamDataAction rejects non-sysadmins", async () => {
    mockIsSystemAdmin.mockResolvedValue(false);
    await expect(
      clearAllTeamDataAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/System admin/);
  });

  it("cleanupOrphanTeamsAction rejects non-sysadmins", async () => {
    mockIsSystemAdmin.mockResolvedValue(false);
    await expect(cleanupOrphanTeamsAction(fd({}))).rejects.toThrow(
      /System admin/,
    );
  });
});

describe("Team owner|admin gate (loadSampleDataAction / removeSampleDataAction / clearAllTeamDataAction)", () => {
  beforeEach(() => {
    reset();
    mockIsSystemAdmin.mockResolvedValue(true);
    state.teamRow = { name: "Acme" };
  });

  it("rejects plain members of the target team", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      loadSampleDataAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/owners or admins/);
  });

  it("rejects when the team is not found", async () => {
    state.teamRow = null;
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await expect(
      loadSampleDataAction(fd({ team_id: "t-nope" })),
    ).rejects.toThrow(/Team not found/);
  });
});

describe("clearAllTeamDataAction typed-confirm gate", () => {
  beforeEach(() => {
    reset();
    mockIsSystemAdmin.mockResolvedValue(true);
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.teamRow = { name: "Acme" };
  });

  it("rejects when the typed confirm doesn't match the team name", async () => {
    await expect(
      clearAllTeamDataAction(fd({ team_id: "t-1", confirm_name: "Acm" })),
    ).rejects.toThrow(/Typed confirmation did not match/);
    // No wipe issued.
    expect(state.adminDeletes).toHaveLength(0);
  });

  it("rejects when confirm_name is omitted entirely", async () => {
    await expect(
      clearAllTeamDataAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/Typed confirmation did not match/);
  });

  it("is case-sensitive (Acme ≠ acme)", async () => {
    await expect(
      clearAllTeamDataAction(fd({ team_id: "t-1", confirm_name: "acme" })),
    ).rejects.toThrow(/Typed confirmation/);
  });

  it("on a correctly-confirmed wipe, completes without error", async () => {
    // The action's wipe calls go through the user supabase client
    // (`supabase.from("invoices").delete().eq("team_id", X)` etc.) —
    // those land via the user-chain's terminal `then` handler with
    // null error, so the action returns success. We don't assert on
    // the precise table list here because the chain doesn't record
    // user-side deletes (only admin-side); the value of this test is
    // that the typed-confirm gate was passed and the action got to
    // the end of the wipe sequence without throwing.
    const result = await clearAllTeamDataAction(
      fd({ team_id: "t-1", confirm_name: "Acme" }),
    );
    expect(result).toEqual({ success: true });
  });
});

describe("revalidatePath fan-out (cleanupOrphanTeamsAction only — the other actions tunnel into deep helpers that need their own fixture suite)", () => {
  beforeEach(() => {
    reset();
    mockIsSystemAdmin.mockResolvedValue(true);
  });

  it("cleanupOrphanTeamsAction revalidates /system/teams + /system/sample-data", async () => {
    await cleanupOrphanTeamsAction(fd({}));
    const calls = mockRevalidatePath.mock.calls.map((c) => c[0]);
    expect(calls).toContain("/system/teams");
    expect(calls).toContain("/system/sample-data");
  });
});
