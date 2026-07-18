import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeUserId = "u-caller";

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

const mockValidateTeamAccess = vi.fn(async () => ({ role: "owner" }));
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (...args: unknown[]) =>
    mockValidateTeamAccess(...(args as [])),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

// Per-row authorization filter — covered by bulk-auth.test.ts. Pass
// everything through unless a test overrides it.
const mockFilterAuthorized = vi.fn(
  (rows: Array<{ id: string }>): string[] => rows.map((r) => r.id),
);
vi.mock("./bulk-auth", () => ({
  filterAuthorizedExpenseIds: (
    rows: Array<{ id: string }>,
    ...rest: unknown[]
  ) => mockFilterAuthorized(rows, ...(rest as [])),
}));

// Invoiced-lock filter — covered by expense-lock-helpers.test.ts.
const mockFilterUninvoiced = vi.fn(
  async (_s: unknown, ids: readonly string[]): Promise<string[]> => [...ids],
);
vi.mock("@/lib/expenses/expense-lock-helpers", () => ({
  filterUninvoicedExpenseIds: (s: unknown, ids: readonly string[]) =>
    mockFilterUninvoiced(s, ids),
}));

// Filter-scope machinery — covered by its own suites; the tests here
// use the explicit-ids scope so these never run.
vi.mock("./filter-params", () => ({
  parseExpenseFilters: vi.fn(),
}));
vi.mock("./query-filters", () => ({
  applyExpenseFilters: vi.fn(),
}));
vi.mock("./filter-formdata", () => ({
  readFilterParamsFromFormData: vi.fn(),
}));

interface SeedRow {
  id: string;
  team_id: string;
  user_id: string;
  project_id: string | null;
}

const state: {
  rows: SeedRow[];
  updates: { patch: Record<string, unknown>; ids: string[] }[];
} = {
  rows: [],
  updates: [],
};

function mockSupabase() {
  return {
    from: (table: string) => {
      if (table !== "expenses") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: (cols: string) => ({
          in: (_col: string, ids: string[]) => {
            const matched = state.rows.filter((r) => ids.includes(r.id));
            const data = cols.includes("project_id")
              ? cols.includes("team_id")
                ? matched
                : matched.map((r) => ({ project_id: r.project_id }))
              : matched;
            return Promise.resolve({ data, error: null });
          },
        }),
        update: (patch: Record<string, unknown>) => ({
          in: (_col: string, ids: string[]) => {
            state.updates.push({ patch, ids });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    },
  };
}

import {
  bulkUpdateExpenseCategoryAction,
  bulkUpdateExpenseBillableAction,
  bulkDeleteExpensesAction,
  bulkRestoreExpensesAction,
} from "./actions";

function fd(
  entries: Record<string, string>,
  ids: string[] = [],
): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  for (const id of ids) f.append("id", id);
  return f;
}

beforeEach(() => {
  state.rows = [
    { id: "e1", team_id: "t1", user_id: "u-caller", project_id: "p1" },
    { id: "e2", team_id: "t1", user_id: "u-other", project_id: null },
  ];
  state.updates = [];
  mockValidateTeamAccess.mockClear();
  mockRevalidatePath.mockReset();
  mockFilterAuthorized.mockClear();
  mockFilterUninvoiced.mockClear();
});

describe("bulkUpdateExpenseCategoryAction", () => {
  it("rejects a category outside the allow-list before touching rows", async () => {
    await expect(
      bulkUpdateExpenseCategoryAction(
        fd({ category: "not-a-category" }, ["e1"]),
      ),
    ).rejects.toThrow(/Invalid category/);
    expect(state.updates).toHaveLength(0);
  });

  it("updates authorized rows and revalidates business + affected project pages", async () => {
    await bulkUpdateExpenseCategoryAction(
      fd({ category: "travel" }, ["e1", "e2"]),
    );
    expect(state.updates).toEqual([
      { patch: { category: "travel" }, ids: ["e1", "e2"] },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business/expenses");
    // e1 links to p1; e2 has no project → only /projects/p1 flushes.
    expect(mockRevalidatePath).toHaveBeenCalledWith("/projects/p1");
    expect(mockRevalidatePath).toHaveBeenCalledTimes(3);
  });

  it("throws when every selected row is invoice-locked", async () => {
    mockFilterUninvoiced.mockResolvedValueOnce([]);
    await expect(
      bulkUpdateExpenseCategoryAction(fd({ category: "travel" }, ["e1"])),
    ).rejects.toThrow(/locked because they're on an invoice/);
    expect(state.updates).toHaveLength(0);
  });

  it("throws when authorization filters out every row", async () => {
    mockFilterAuthorized.mockReturnValueOnce([]);
    await expect(
      bulkUpdateExpenseCategoryAction(fd({ category: "travel" }, ["e1"])),
    ).rejects.toThrow(/None of the selected rows/);
  });
});

describe("bulkUpdateExpenseBillableAction", () => {
  it("parses true / false / clear payloads and rejects junk", async () => {
    await bulkUpdateExpenseBillableAction(fd({ billable: "true" }, ["e1"]));
    await bulkUpdateExpenseBillableAction(fd({ billable: "false" }, ["e1"]));
    await bulkUpdateExpenseBillableAction(fd({ billable: "" }, ["e1"]));
    expect(state.updates.map((u) => u.patch)).toEqual([
      { billable: true },
      { billable: false },
      { billable: null },
    ]);
    await expect(
      bulkUpdateExpenseBillableAction(fd({ billable: "yes" }, ["e1"])),
    ).rejects.toThrow(/Invalid billable value/);
  });
});

describe("bulkDeleteExpensesAction", () => {
  it("soft-deletes (deleted_at timestamp) rather than hard-deleting", async () => {
    await bulkDeleteExpensesAction(fd({}, ["e1"]));
    expect(state.updates).toHaveLength(1);
    const patch = state.updates[0]?.patch ?? {};
    expect(typeof patch.deleted_at).toBe("string");
    expect(Number.isNaN(Date.parse(String(patch.deleted_at)))).toBe(false);
  });

  it("refuses when all rows are on invoices", async () => {
    mockFilterUninvoiced.mockResolvedValueOnce([]);
    await expect(
      bulkDeleteExpensesAction(fd({}, ["e1", "e2"])),
    ).rejects.toThrow(/on an invoice and cannot be deleted/);
    expect(state.updates).toHaveLength(0);
  });
});

describe("bulkRestoreExpensesAction", () => {
  it("clears deleted_at on authorized rows (Undo path)", async () => {
    await bulkRestoreExpensesAction(fd({}, ["e1", "e2"]));
    expect(state.updates).toEqual([
      { patch: { deleted_at: null }, ids: ["e1", "e2"] },
    ]);
  });

  it("throws when no ids are supplied", async () => {
    await expect(bulkRestoreExpensesAction(fd({}))).rejects.toThrow(
      /No rows specified/,
    );
  });

  it("returns quietly when nothing is authorized (no error leak about other teams)", async () => {
    mockFilterAuthorized.mockReturnValueOnce([]);
    await expect(
      bulkRestoreExpensesAction(fd({}, ["e1"])),
    ).resolves.toEqual({ success: true });
    expect(state.updates).toHaveLength(0);
  });
});
