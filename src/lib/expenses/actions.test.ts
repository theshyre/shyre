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

// split validation is covered by split-helpers.test.ts — mocked here
// so splitExpenseAction tests control the ok/fail outcome directly.
vi.mock("./split-helpers", () => ({
  validateSplits: vi.fn(),
}));

interface ExpenseRow {
  team_id: string;
  user_id: string;
  deleted_at?: string | null;
  // Wider columns used by splitExpenseAction. Optional so simpler
  // delete/restore tests don't need to seed them.
  id?: string;
  incurred_on?: string;
  amount?: number;
  currency?: string;
  vendor?: string | null;
  external_reference?: string | null;
  description?: string | null;
  notes?: string | null;
  project_id?: string | null;
  billable?: boolean;
  /** Phase 2 lock — when true, every mutation other than restore
   *  throws the "on an invoice and is locked" error. */
  invoiced?: boolean;
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
  splitExpenseAction,
  updateExpenseAction,
  updateExpenseFieldAction,
} from "./actions";
import { validateSplits } from "./split-helpers";

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

  it("stores external_reference verbatim (prefix preserved)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await createExpenseAction(
      fd({ ...VALID_CREATE, external_reference: "INV-2024-0098" }),
    );
    const inserted = state.inserts[0]?.rows as Record<string, unknown>;
    expect(inserted.external_reference).toBe("INV-2024-0098");
  });

  it("blank external_reference is normalized to null", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    // Absent entirely.
    await createExpenseAction(fd(VALID_CREATE));
    expect(
      (state.inserts[0]?.rows as Record<string, unknown>).external_reference,
    ).toBeNull();

    // Present but whitespace-only.
    state.inserts = [];
    await createExpenseAction(
      fd({ ...VALID_CREATE, external_reference: "   " }),
    );
    expect(
      (state.inserts[0]?.rows as Record<string, unknown>).external_reference,
    ).toBeNull();
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

describe("splitExpenseAction", () => {
  beforeEach(() => {
    reset();
    // Default: validateSplits returns ok=true for any input. Tests
    // that check the refusal path override this.
    vi.mocked(validateSplits).mockReturnValue({
      ok: true,
      summary: null,
      perSplit: {},
    });
  });

  function seedOriginal(): void {
    state.fetchedExpense = {
      id: "e-1",
      team_id: "team-1",
      user_id: fakeUserId,
      deleted_at: null,
      incurred_on: "2026-04-15",
      amount: 100,
      currency: "USD",
      vendor: "GitHub",
      external_reference: "INV-9000",
      description: "subscription",
      notes: "annual",
      project_id: null,
      billable: false,
    };
  }

  function splitsJson(splits: Array<{
    amount: number;
    category: string;
    notes?: string | null;
  }>): string {
    return JSON.stringify(
      splits.map((s) => ({
        amount: s.amount,
        category: s.category,
        notes: s.notes ?? null,
      })),
    );
  }

  it("updates the original to splits[0] and inserts the rest", async () => {
    seedOriginal();
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await splitExpenseAction(
      fd({
        id: "e-1",
        splits: splitsJson([
          { amount: 60, category: "software" },
          { amount: 30, category: "subscriptions" },
          { amount: 10, category: "fees" },
        ]),
      }),
    );

    // Original got updated to splits[0].
    expect(state.updates).toHaveLength(1);
    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.amount).toBe(60);
    expect(patch.category).toBe("software");
    // notes preserved (no override) — split inherits original.notes.
    expect(patch.notes).toBe("annual");
    expect(state.updates[0]?.where).toEqual({ id: "e-1" });

    // Two new rows inserted (splits[1] + splits[2]). They inherit
    // the original's date / vendor / description / project / billable.
    expect(state.inserts).toHaveLength(1);
    const inserted = state.inserts[0]?.rows as Array<Record<string, unknown>>;
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      team_id: "team-1",
      user_id: fakeUserId,
      incurred_on: "2026-04-15",
      amount: 30,
      category: "subscriptions",
      currency: "USD",
      vendor: "GitHub",
      // external_reference is inherited from the original onto every
      // split row (the document number applies to all the pieces).
      external_reference: "INV-9000",
      description: "subscription",
      notes: null,
      billable: false,
    });
    expect(inserted[1]).toMatchObject({
      amount: 10,
      category: "fees",
    });
  });

  it("uses the per-split notes override when supplied", async () => {
    seedOriginal();
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await splitExpenseAction(
      fd({
        id: "e-1",
        splits: splitsJson([
          { amount: 60, category: "software", notes: "Q1 share" },
          { amount: 40, category: "subscriptions", notes: "Q2 share" },
        ]),
      }),
    );

    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.notes).toBe("Q1 share");
    const inserted = state.inserts[0]?.rows as Array<Record<string, unknown>>;
    expect(inserted[0]?.notes).toBe("Q2 share");
  });

  it("works when only one split is supplied (no inserts; just an update)", async () => {
    seedOriginal();
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await splitExpenseAction(
      fd({
        id: "e-1",
        splits: splitsJson([{ amount: 100, category: "subscriptions" }]),
      }),
    );

    expect(state.updates).toHaveLength(1);
    expect(state.inserts).toEqual([]);
  });

  it("refuses to split a soft-deleted expense", async () => {
    seedOriginal();
    state.fetchedExpense = {
      ...state.fetchedExpense!,
      deleted_at: "2026-04-15T00:00:00Z",
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      splitExpenseAction(
        fd({
          id: "e-1",
          splits: splitsJson([
            { amount: 60, category: "software" },
            { amount: 40, category: "subscriptions" },
          ]),
        }),
      ),
    ).rejects.toThrow(/deleted/);
    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("refuses when caller is a non-author member (RLS would also block)", async () => {
    seedOriginal();
    state.fetchedExpense = {
      ...state.fetchedExpense!,
      user_id: "u-other",
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      splitExpenseAction(
        fd({
          id: "e-1",
          splits: splitsJson([
            { amount: 60, category: "software" },
            { amount: 40, category: "subscriptions" },
          ]),
        }),
      ),
    ).rejects.toThrow(/author.*owner.*admin/i);
  });

  it("admin can split (not the author)", async () => {
    seedOriginal();
    state.fetchedExpense = {
      ...state.fetchedExpense!,
      user_id: "u-other",
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });

    await splitExpenseAction(
      fd({
        id: "e-1",
        splits: splitsJson([
          { amount: 50, category: "software" },
          { amount: 50, category: "subscriptions" },
        ]),
      }),
    );

    expect(state.updates).toHaveLength(1);
  });

  it("propagates the validation summary when splits don't sum correctly", async () => {
    seedOriginal();
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    vi.mocked(validateSplits).mockReturnValue({
      ok: false,
      summary: "Splits must sum to $100.00",
      perSplit: {},
    });

    await expect(
      splitExpenseAction(
        fd({
          id: "e-1",
          splits: splitsJson([
            { amount: 50, category: "software" },
            // sums to $50, not the original $100
          ]),
        }),
      ),
    ).rejects.toThrow(/sum to \$100/);
    expect(state.updates).toEqual([]);
  });

  it("rejects when the splits payload is not valid JSON", async () => {
    await expect(
      splitExpenseAction(fd({ id: "e-1", splits: "not-json" })),
    ).rejects.toThrow(/invalid/i);
    expect(state.updates).toEqual([]);
  });

  it("rejects when the splits payload is not an array", async () => {
    await expect(
      splitExpenseAction(
        fd({ id: "e-1", splits: '{"amount": 100}' }),
      ),
    ).rejects.toThrow(/array|invalid/i);
    expect(state.updates).toEqual([]);
  });

  it("rejects when id is missing (no DB read)", async () => {
    await expect(
      splitExpenseAction(
        fd({ splits: splitsJson([{ amount: 100, category: "software" }]) }),
      ),
    ).rejects.toThrow(/Expense id required/);
  });

  it("rejects when splits payload is missing", async () => {
    await expect(splitExpenseAction(fd({ id: "e-1" }))).rejects.toThrow(
      /Splits payload required/,
    );
  });

  it("rounds split amounts to 2dp before write", async () => {
    seedOriginal();
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await splitExpenseAction(
      fd({
        id: "e-1",
        splits: splitsJson([
          { amount: 33.333, category: "software" },
          { amount: 66.667, category: "subscriptions" },
        ]),
      }),
    );

    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.amount).toBe(33.33);
    const inserted = state.inserts[0]?.rows as Array<Record<string, unknown>>;
    expect(inserted[0]?.amount).toBe(66.67);
  });
});

describe("updateExpenseFieldAction — external_reference", () => {
  beforeEach(reset);

  it("writes a single external_reference value verbatim", async () => {
    state.fetchedExpense = { team_id: "team-1", user_id: fakeUserId };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await updateExpenseFieldAction(
      fd({ id: "e-1", field: "external_reference", value: "PO-2231" }),
    );

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.patch).toEqual({ external_reference: "PO-2231" });
  });

  it("clears external_reference to null when the value is blank", async () => {
    state.fetchedExpense = { team_id: "team-1", user_id: fakeUserId };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await updateExpenseFieldAction(
      fd({ id: "e-1", field: "external_reference", value: "   " }),
    );

    expect(state.updates[0]?.patch).toEqual({ external_reference: null });
  });

  it("rejects an unknown field name (allow-list gate)", async () => {
    await expect(
      updateExpenseFieldAction(
        fd({ id: "e-1", field: "reference", value: "x" }),
      ),
    ).rejects.toThrow(/cannot be edited/);
    expect(state.updates).toEqual([]);
  });
});

describe("phase-2 invoiced lock", () => {
  beforeEach(reset);

  it("updateExpenseAction refuses an invoiced row even for the author", async () => {
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: fakeUserId,
      invoiced: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      updateExpenseAction(fd({ id: "e-1", ...VALID_CREATE })),
    ).rejects.toThrow(/on an invoice and is locked/);
    expect(state.updates).toEqual([]);
  });

  it("updateExpenseFieldAction refuses a LOCKED financial field on an invoiced row", async () => {
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: "u-other",
      invoiced: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });

    await expect(
      updateExpenseFieldAction(fd({ id: "e-1", field: "amount", value: "999" })),
    ).rejects.toThrow(/locked while this expense is on an invoice/);
    expect(state.updates).toEqual([]);
  });

  it("updateExpenseFieldAction ALLOWS editing metadata (vendor) on an invoiced row", async () => {
    // Field-level lock: the invoice snapshots the expense, so editing
    // vendor/reference/description/notes/category can't mutate it.
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: "u-other",
      invoiced: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });

    await updateExpenseFieldAction(
      fd({ id: "e-1", field: "vendor", value: "new vendor" }),
    );

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.patch).toMatchObject({ vendor: "new vendor" });
  });

  it("deleteExpenseAction refuses an invoiced row", async () => {
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: fakeUserId,
      invoiced: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(deleteExpenseAction(fd({ id: "e-1" }))).rejects.toThrow(
      /on an invoice and is locked/,
    );
    expect(state.updates).toEqual([]);
  });

  it("splitExpenseAction refuses an invoiced row (would re-write accounting)", async () => {
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: fakeUserId,
      amount: 100,
      currency: "USD",
      vendor: null,
      description: null,
      notes: null,
      project_id: null,
      billable: true,
      incurred_on: "2026-04-15",
      invoiced: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      splitExpenseAction(
        fd({
          id: "e-1",
          splits: JSON.stringify([
            { amount: 60, category: "software" },
            { amount: 40, category: "subscriptions" },
          ]),
        }),
      ),
    ).rejects.toThrow(/on an invoice and is locked/);
    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("restoreExpenseAction does NOT apply the lock — recovery is always allowed", async () => {
    // Restoring a soft-deleted, invoiced row simply flips deleted_at
    // back to null — it doesn't change anything the invoice references.
    // Locking restore would trap users in a state where they can't
    // even recover a row that was deleted by mistake.
    state.fetchedExpense = {
      team_id: "team-1",
      user_id: fakeUserId,
      deleted_at: "2026-04-15T00:00:00Z",
      invoiced: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await restoreExpenseAction(fd({ id: "e-1" }));

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.patch).toEqual({ deleted_at: null });
  });
});
