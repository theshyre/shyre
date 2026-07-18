import { describe, it, expect, vi, beforeEach } from "vitest";

// importExpensesCsvAction deliberately does NOT go through
// runSafeAction (it returns a payload), so unlike the sibling action
// tests we mock the Supabase client + logger directly and exercise
// the real auth-guard / failure-envelope code. The CSV parser stays
// REAL — parse behavior (skips, vendor split, dedupe hashes) is part
// of the action's observable contract.

const mockValidateTeamAccess = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (...args: unknown[]) => mockValidateTeamAccess(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

interface SupaError {
  message: string;
  code?: string;
}

interface ExpenseInsertRow {
  team_id: string;
  user_id: string;
  incurred_on: string;
  amount: number;
  currency: string;
  vendor: string | null;
  category: string;
  description: string | null;
  notes: string | null;
  billable: boolean;
  imported_from: string;
  import_source_id: string;
  import_run_id: string;
  imported_at: string;
}

const state: {
  user: { id: string } | null;
  runInserts: Record<string, unknown>[];
  runInsertError: SupaError | null;
  runUpdates: { patch: Record<string, unknown>; id: string }[];
  batchInserts: ExpenseInsertRow[][];
  rowInserts: ExpenseInsertRow[];
  /** Error for the whole-batch insert. */
  batchError: SupaError | null;
  /** Throw (network-style) instead of returning an error envelope. */
  batchThrows: boolean;
  /** import_source_ids that per-row inserts treat as duplicates. */
  duplicateSourceIds: Set<string>;
  /** import_source_ids whose per-row insert fails hard. */
  hardFailSourceIds: Set<string>;
} = {
  user: { id: "u-importer" },
  runInserts: [],
  runInsertError: null,
  runUpdates: [],
  batchInserts: [],
  rowInserts: [],
  batchError: null,
  batchThrows: false,
  duplicateSourceIds: new Set(),
  hardFailSourceIds: new Set(),
};

function mockSupabase() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: state.user } }),
    },
    from: (table: string) => {
      if (table === "import_runs") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.runInserts.push(row);
            return Promise.resolve({ error: state.runInsertError });
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              state.runUpdates.push({ patch, id });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === "expenses") {
        return {
          insert: (
            rows: ExpenseInsertRow | ExpenseInsertRow[],
            opts?: { count?: string },
          ) => {
            if (Array.isArray(rows)) {
              if (state.batchThrows) {
                return Promise.reject(new Error("connection reset"));
              }
              state.batchInserts.push(rows);
              if (state.batchError) {
                return Promise.resolve({
                  error: state.batchError,
                  count: null,
                });
              }
              return Promise.resolve({
                error: null,
                count: opts?.count === "exact" ? rows.length : null,
              });
            }
            // Per-row fallback path after a 23505 batch failure.
            state.rowInserts.push(rows);
            if (state.duplicateSourceIds.has(rows.import_source_id)) {
              return Promise.resolve({
                error: { message: "duplicate key", code: "23505" },
              });
            }
            if (state.hardFailSourceIds.has(rows.import_source_id)) {
              return Promise.resolve({
                error: { message: "row exploded", code: "XX000" },
              });
            }
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import { importExpensesCsvAction } from "./actions";
import {
  DEFAULT_IMPORTED_CATEGORY,
  EXPENSE_CSV_SOURCE,
  parseExpenseCsv,
} from "@/lib/expense-csv-import";

function resetState(): void {
  state.user = { id: "u-importer" };
  state.runInserts = [];
  state.runInsertError = null;
  state.runUpdates = [];
  state.batchInserts = [];
  state.rowInserts = [];
  state.batchError = null;
  state.batchThrows = false;
  state.duplicateSourceIds = new Set();
  state.hardFailSourceIds = new Set();
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({
    userId: "u-importer",
    role: "owner",
  });
  mockRevalidatePath.mockReset();
  mockLogError.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const GOOD_CSV = [
  "Date,Amount,Item,Comments",
  '1/15/2026,"$1,234.50",Linode - server hosting,inv-1001',
  "2026-01-16,$80.00,Networking equipment from Platt,",
].join("\n");

describe("importExpensesCsvAction — guards", () => {
  beforeEach(resetState);

  it("returns a failure envelope (not a throw) when unauthenticated, and logs it", async () => {
    state.user = null;
    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: GOOD_CSV }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toBe("Unauthorized");
    }
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AppError" }),
      expect.objectContaining({ action: "importExpensesCsvAction" }),
    );
    expect(state.runInserts).toEqual([]);
  });

  it("requires team_id", async () => {
    const res = await importExpensesCsvAction(fd({ csv: GOOD_CSV }));
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toMatch(/team_id is required/);
    }
  });

  it("requires a non-blank CSV body", async () => {
    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: "   \n " }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toMatch(/CSV body is required/);
    }
  });

  it("rejects a plain member — owner/admin only, with team context in the error log", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: "u-importer",
      role: "member",
    });
    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: GOOD_CSV }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toMatch(/owners and admins/);
    }
    expect(mockLogError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "u-importer", teamId: "t1" }),
    );
    expect(state.runInserts).toEqual([]);
  });
});

describe("importExpensesCsvAction — happy path", () => {
  beforeEach(resetState);

  it("parses, inserts, completes the run, and returns the per-row summary", async () => {
    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: GOOD_CSV }),
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.summary).toMatchObject({
      imported: { expenses: 2 },
      importedCount: 2,
      skipped: 0,
      skippedReasons: [],
      alreadyImported: 0,
      errors: [],
      defaultCategory: DEFAULT_IMPORTED_CATEGORY,
    });

    // Run recorded up-front as running, then completed with the summary.
    expect(state.runInserts[0]).toMatchObject({
      team_id: "t1",
      triggered_by_user_id: "u-importer",
      imported_from: EXPENSE_CSV_SOURCE,
      status: "running",
    });
    expect(state.runUpdates[0]?.patch).toMatchObject({ status: "completed" });
    expect(state.runUpdates[0]?.id).toBe(res.summary.importRunId);

    // Inserted rows carry the vendor split + import provenance.
    const rows = state.batchInserts[0];
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toMatchObject({
      team_id: "t1",
      user_id: "u-importer",
      incurred_on: "2026-01-15",
      amount: 1234.5,
      currency: "USD",
      vendor: "Linode",
      description: "server hosting",
      notes: "inv-1001",
      billable: false,
      category: DEFAULT_IMPORTED_CATEGORY,
      imported_from: EXPENSE_CSV_SOURCE,
      import_run_id: res.summary.importRunId,
    });
    // No " - " separator → whole item is the description, vendor null.
    expect(rows?.[1]).toMatchObject({
      vendor: null,
      description: "Networking equipment from Platt",
    });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/import");
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("reports unparseable rows in skippedReasons with their line numbers", async () => {
    const csv = [
      "Date,Amount,Item,Comments",
      "1/15/2026,$10.00,Ok - row,",
      "not-a-date,$10.00,Bad - date,",
      "1/17/2026,minus five,Bad - amount,",
    ].join("\n");
    const res = await importExpensesCsvAction(fd({ team_id: "t1", csv }));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.summary.importedCount).toBe(1);
    expect(res.summary.skipped).toBe(2);
    expect(res.summary.skippedReasons).toEqual([
      { rowNumber: 3, reason: expect.stringMatching(/Invalid or missing date/) as unknown },
      { rowNumber: 4, reason: expect.stringMatching(/Invalid or missing amount/) as unknown },
    ]);
    // Expected business outcomes are NOT error-logged.
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe("importExpensesCsvAction — dedupe & failure paths", () => {
  beforeEach(resetState);

  it("falls back to per-row inserts on a 23505 batch conflict and counts duplicates as alreadyImported", async () => {
    state.batchError = { message: "duplicate key", code: "23505" };
    // Mark row 1 (Linode) as the duplicate via its deterministic hash.
    const parsed = parseExpenseCsv(GOOD_CSV);
    const linodeId = parsed.rows[0]?.import_source_id;
    if (!linodeId) throw new Error("fixture parse failed");
    state.duplicateSourceIds = new Set([linodeId]);

    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: GOOD_CSV }),
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.summary.importedCount).toBe(1);
    expect(res.summary.alreadyImported).toBe(1);
    expect(res.summary.errors).toEqual([]);
    // All rows retried individually.
    expect(state.rowInserts).toHaveLength(2);
    expect(state.runUpdates[0]?.patch).toMatchObject({ status: "completed" });
  });

  it("collects a non-duplicate per-row failure into summary.errors without aborting the run", async () => {
    state.batchError = { message: "duplicate key", code: "23505" };
    const parsed = parseExpenseCsv(GOOD_CSV);
    const plattId = parsed.rows[1]?.import_source_id;
    if (!plattId) throw new Error("fixture parse failed");
    state.hardFailSourceIds = new Set([plattId]);

    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: GOOD_CSV }),
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.summary.importedCount).toBe(1);
    expect(res.summary.errors).toEqual(["row exploded"]);
  });

  it("reports a non-conflict batch error in summary.errors (still success:true)", async () => {
    state.batchError = { message: "value too long", code: "22001" };
    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: GOOD_CSV }),
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.summary.importedCount).toBe(0);
    expect(res.summary.errors).toEqual([
      "Batch insert failed: value too long",
    ]);
    // No per-row retry for non-23505 failures.
    expect(state.rowInserts).toEqual([]);
  });

  it("fails cleanly when the run itself can't be recorded", async () => {
    state.runInsertError = { message: "constraint violated" };
    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: GOOD_CSV }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toMatch(
        /Could not record import run: constraint violated/,
      );
    }
    expect(state.batchInserts).toEqual([]);
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it("marks the run failed and returns a failure envelope on a mid-import crash", async () => {
    state.batchThrows = true;
    const res = await importExpensesCsvAction(
      fd({ team_id: "t1", csv: GOOD_CSV }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toBe("connection reset");
    }
    expect(state.runUpdates[0]?.patch).toMatchObject({ status: "failed" });
    const failSummary = state.runUpdates[0]?.patch.summary as {
      errors: string[];
    };
    expect(failSummary.errors).toContain("connection reset");
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
