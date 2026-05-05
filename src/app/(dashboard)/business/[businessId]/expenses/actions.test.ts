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
  validateTeamAccess: (...args: unknown[]) =>
    mockValidateTeamAccess(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

// bulk-auth + filter helpers — out of scope for these tests.
vi.mock("./bulk-auth", () => ({
  filterAuthorizedExpenseIds: vi.fn(),
}));
vi.mock("./split-helpers", () => ({
  validateSplits: vi.fn(),
}));
vi.mock("./filter-params", () => ({
  parseExpenseFilters: vi.fn(),
}));
vi.mock("./query-filters", () => ({
  applyExpenseFilters: vi.fn(),
}));
vi.mock("./filter-formdata", () => ({
  readFilterParamsFromFormData: vi.fn(),
}));

interface ExpenseRow {
  team_id: string;
  user_id: string;
  deleted_at?: string | null;
}

const state: {
  fetchedExpense: ExpenseRow | null;
  inserts: { table: string; rows: unknown }[];
  updates: { table: string; patch: unknown; where: Record<string, string> }[];
} = {
  fetchedExpense: null,
  inserts: [],
  updates: [],
};

function mockSupabase() {
  return {
    from: (table: string) => {
      if (table !== "expenses") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert: (rows: unknown) => {
          state.inserts.push({ table: "expenses", rows });
          return Promise.resolve({ data: null, error: null });
        },
        update: (patch: unknown) => ({
          eq: (col: string, val: string) => {
            state.updates.push({
              table: "expenses",
              patch,
              where: { [col]: val },
            });
            return Promise.resolve({ data: null, error: null });
          },
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: state.fetchedExpense, error: null }),
          }),
        }),
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  createExpenseAction,
  deleteExpenseAction,
  restoreExpenseAction,
  updateExpenseAction,
} from "./actions";

function reset(): void {
  state.fetchedExpense = null;
  state.inserts = [];
  state.updates = [];
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const VALID_CREATE = {
  team_id: "team-1",
  incurred_on: "2026-04-15",
  amount: "42.50",
  category: "software",
  vendor: "GitHub",
};

describe("createExpenseAction", () => {
  beforeEach(reset);

  it("inserts a row with the user_id, team_id, and parsed expense fields", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createExpenseAction(fd(VALID_CREATE));

    expect(state.inserts).toHaveLength(1);
    const inserted = state.inserts[0]?.rows as Record<string, unknown>;
    expect(inserted.user_id).toBe(fakeUserId);
    expect(inserted.team_id).toBe("team-1");
    expect(inserted.incurred_on).toBe("2026-04-15");
    expect(inserted.amount).toBe(42.5);
    expect(inserted.category).toBe("software");
    expect(inserted.vendor).toBe("GitHub");
    expect(inserted.currency).toBe("USD");
    expect(inserted.billable).toBe(false);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business/expenses");
  });

  it("validates team access before any DB write", async () => {
    mockValidateTeamAccess.mockRejectedValue(new Error("Access denied"));

    await expect(createExpenseAction(fd(VALID_CREATE))).rejects.toThrow(
      /Access denied/,
    );
    expect(state.inserts).toEqual([]);
  });

  it("rejects a malformed date (YYYY-MM-DD only)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      createExpenseAction(fd({ ...VALID_CREATE, incurred_on: "yesterday" })),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(state.inserts).toEqual([]);
  });

  it("rejects a negative amount", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      createExpenseAction(fd({ ...VALID_CREATE, amount: "-5" })),
    ).rejects.toThrow(/non-negative/);
    expect(state.inserts).toEqual([]);
  });

  it("rejects a non-numeric amount", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      createExpenseAction(fd({ ...VALID_CREATE, amount: "abc" })),
    ).rejects.toThrow(/non-negative/);
    expect(state.inserts).toEqual([]);
  });

  it("rejects a category that isn't in the allow-list", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      createExpenseAction(fd({ ...VALID_CREATE, category: "yacht" })),
    ).rejects.toThrow(/category/);
    expect(state.inserts).toEqual([]);
  });

  it("rounds amount to 2dp at the boundary (no float drift in the DB)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createExpenseAction(fd({ ...VALID_CREATE, amount: "10.005" }));
    const inserted = state.inserts[0]?.rows as Record<string, unknown>;
    expect(inserted.amount).toBe(10.01);
  });

  it("billable=on coerces to true; absent coerces to false", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createExpenseAction(fd({ ...VALID_CREATE, billable: "on" }));
    expect(
      (state.inserts[0]?.rows as Record<string, unknown>).billable,
    ).toBe(true);

    state.inserts = [];
    await createExpenseAction(fd(VALID_CREATE));
    expect(
      (state.inserts[0]?.rows as Record<string, unknown>).billable,
    ).toBe(false);
  });

  it("project_id='none' is normalized to null", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createExpenseAction(fd({ ...VALID_CREATE, project_id: "none" }));
    const inserted = state.inserts[0]?.rows as Record<string, unknown>;
    expect(inserted.project_id).toBeNull();
  });
});

describe("updateExpenseAction", () => {
  beforeEach(reset);

  it("updates when caller is the author (member role)", async () => {
    state.fetchedExpense = { team_id: "team-1", user_id: fakeUserId };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await updateExpenseAction(
      fd({ id: "e-1", ...VALID_CREATE, amount: "100" }),
    );

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.where).toEqual({ id: "e-1" });
  });

  it("updates when caller is owner/admin even if not the author", async () => {
    state.fetchedExpense = { team_id: "team-1", user_id: "u-other" };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });

    await updateExpenseAction(fd({ id: "e-1", ...VALID_CREATE }));

    expect(state.updates).toHaveLength(1);
  });

  it("refuses when caller is a non-author member", async () => {
    state.fetchedExpense = { team_id: "team-1", user_id: "u-other" };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      updateExpenseAction(fd({ id: "e-1", ...VALID_CREATE })),
    ).rejects.toThrow(/author.*owner.*admin/i);
    expect(state.updates).toEqual([]);
  });

  it("rejects when the expense doesn't exist", async () => {
    state.fetchedExpense = null;

    await expect(
      updateExpenseAction(fd({ id: "missing", ...VALID_CREATE })),
    ).rejects.toThrow(/not found/i);
    expect(state.updates).toEqual([]);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
  });

  it("rejects without an id", async () => {
    await expect(
      updateExpenseAction(fd({ ...VALID_CREATE })),
    ).rejects.toThrow(/Expense id required/);
  });
});

describe("deleteExpenseAction", () => {
  beforeEach(reset);

  it("soft-deletes when caller is the author", async () => {
    state.fetchedExpense = { team_id: "team-1", user_id: fakeUserId };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await deleteExpenseAction(fd({ id: "e-1" }));

    expect(state.updates).toHaveLength(1);
    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.deleted_at).toBeTypeOf("string");
    expect(state.updates[0]?.where).toEqual({ id: "e-1" });
  });

  it("soft-deletes when caller is owner (not the author)", async () => {
    state.fetchedExpense = { team_id: "team-1", user_id: "u-other" };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });

    await deleteExpenseAction(fd({ id: "e-1" }));

    expect(state.updates).toHaveLength(1);
  });

  it("refuses a non-author member", async () => {
    state.fetchedExpense = { team_id: "team-1", user_id: "u-other" };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      deleteExpenseAction(fd({ id: "e-1" })),
    ).rejects.toThrow(/author.*owner.*admin/i);
    expect(state.updates).toEqual([]);
  });

  it("rejects missing id (no DB read)", async () => {
    await expect(deleteExpenseAction(fd({}))).rejects.toThrow(
      /Expense id required/,
    );
  });

  it("returns 'not found' before role-check when row doesn't resolve", async () => {
    state.fetchedExpense = null;

    await expect(
      deleteExpenseAction(fd({ id: "missing" })),
    ).rejects.toThrow(/not found/i);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
  });
});

describe("restoreExpenseAction", () => {
  beforeEach(reset);

  it("flips deleted_at back to null when caller is the author", async () => {
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: fakeUserId,
      deleted_at: "2026-04-15T00:00:00Z",
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await restoreExpenseAction(fd({ id: "e-1" }));

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.patch).toEqual({ deleted_at: null });
  });

  it("is idempotent — already-restored expense returns without an update", async () => {
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: fakeUserId,
      deleted_at: null,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await restoreExpenseAction(fd({ id: "e-1" }));

    expect(state.updates).toEqual([]);
  });

  it("refuses a non-author member", async () => {
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: "u-other",
      deleted_at: "2026-04-15T00:00:00Z",
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      restoreExpenseAction(fd({ id: "e-1" })),
    ).rejects.toThrow(/author.*owner.*admin/i);
  });

  it("rejects missing id", async () => {
    await expect(restoreExpenseAction(fd({}))).rejects.toThrow(
      /Expense id required/,
    );
  });
});
