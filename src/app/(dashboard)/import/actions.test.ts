import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  invoicedEntriesRefusalMessage,
  invoicesOnImportedCustomersRefusalMessage,
  manualEntriesOnImportedProjectsRefusalMessage,
  manualProjectsOnImportedCustomersRefusalMessage,
} from "./undo-refusal";

// --- Mock runSafeAction to strip the auth boundary; safe-action.test.ts
// covers the wrapper. Here we test the undo pipeline itself: UUID
// validation, ownership, the four refusal checks, the force unlock
// pre-pass, and the delete ordering.
const fakeUserId = "u-undoer";
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

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const TEAM_ID = "22222222-2222-4222-8222-222222222222";

interface SupaError {
  message: string;
  code?: string;
}

interface Filter {
  m: "eq" | "in" | "not" | "or";
  col?: string;
  val?: unknown;
}

interface RecordedWrite {
  table: string;
  op: "update" | "delete";
  patch?: Record<string, unknown>;
  filters: Filter[];
}

const state: {
  run: { id: string; team_id: string; undone_at: string | null } | null;
  runFetchError: SupaError | null;
  /** time_entries with a non-null invoice_id tagged with this run. */
  invoicedEntries: Array<{ id: string; invoice_id: string }>;
  /** invoices among the linked ids that belong to this same run. */
  sameRunInvoices: Array<{ id: string }>;
  importedCustomers: Array<{ id: string }>;
  /** count of non-run invoices pointing at imported customers. */
  invoicesOnImportedCustomersCount: number;
  importedProjects: Array<{ id: string }>;
  /** manual (non-run) time entries on imported projects. */
  manualEntries: Array<{ project_id: string }>;
  /** manual (non-run) projects under imported customers. */
  manualProjects: Array<{ customer_id: string }>;
  /** all projects under imported customers (force unlock pre-pass). */
  cascadingProjects: Array<{ id: string }>;
  writes: RecordedWrite[];
  /** table → error returned by its delete terminal. */
  deleteError: { table: string; error: SupaError } | null;
} = {
  run: null,
  runFetchError: null,
  invoicedEntries: [],
  sameRunInvoices: [],
  importedCustomers: [],
  invoicesOnImportedCustomersCount: 0,
  importedProjects: [],
  manualEntries: [],
  manualProjects: [],
  cascadingProjects: [],
  writes: [],
  deleteError: null,
};

interface ChainResult {
  data: unknown;
  error: SupaError | null;
  count: number | null;
}

interface QueryChain {
  select: (cols?: string, opts?: { count?: string; head?: boolean }) => QueryChain;
  update: (patch: Record<string, unknown>) => QueryChain;
  delete: () => QueryChain;
  eq: (col: string, val: unknown) => QueryChain;
  in: (col: string, vals: unknown[]) => QueryChain;
  not: (col: string, op: string, val: unknown) => QueryChain;
  or: (expr: string) => QueryChain;
  maybeSingle: () => Promise<ChainResult>;
  then: <T>(
    onFulfilled: (v: ChainResult) => T,
    onRejected?: (e: unknown) => T,
  ) => Promise<T>;
}

function has(filters: Filter[], m: Filter["m"], col?: string): boolean {
  return filters.some((f) => f.m === m && (col === undefined || f.col === col));
}

/** Behavior-level resolver: decides what a settled query returns based
 *  on the table + which filters the production code applied. */
function resolveQuery(
  table: string,
  op: "select" | "update" | "delete",
  patch: Record<string, unknown> | undefined,
  filters: Filter[],
): ChainResult {
  if (op === "update") {
    state.writes.push({ table, op, patch, filters });
    return { data: null, error: null, count: null };
  }
  if (op === "delete") {
    state.writes.push({ table, op, filters });
    const error =
      state.deleteError && state.deleteError.table === table
        ? state.deleteError.error
        : null;
    return { data: null, error, count: null };
  }
  // Selects, keyed by table + filter shape.
  if (table === "import_runs") {
    return { data: state.run, error: state.runFetchError, count: null };
  }
  if (table === "time_entries") {
    if (has(filters, "in", "project_id")) {
      return { data: state.manualEntries, error: null, count: null };
    }
    return { data: state.invoicedEntries, error: null, count: null };
  }
  if (table === "invoices") {
    if (has(filters, "or")) {
      return {
        data: null,
        error: null,
        count: state.invoicesOnImportedCustomersCount,
      };
    }
    return { data: state.sameRunInvoices, error: null, count: null };
  }
  if (table === "customers") {
    return { data: state.importedCustomers, error: null, count: null };
  }
  if (table === "projects") {
    if (has(filters, "eq", "import_run_id")) {
      return { data: state.importedProjects, error: null, count: null };
    }
    if (has(filters, "or")) {
      return { data: state.manualProjects, error: null, count: null };
    }
    return { data: state.cascadingProjects, error: null, count: null };
  }
  throw new Error(`unexpected select on table ${table}`);
}

function mockSupabase() {
  return {
    from: (table: string): QueryChain => {
      let op: "select" | "update" | "delete" = "select";
      let patch: Record<string, unknown> | undefined;
      const filters: Filter[] = [];
      const chain: QueryChain = {
        select: () => chain,
        update: (p) => {
          op = "update";
          patch = p;
          return chain;
        },
        delete: () => {
          op = "delete";
          return chain;
        },
        eq: (col, val) => {
          filters.push({ m: "eq", col, val });
          return chain;
        },
        in: (col, vals) => {
          filters.push({ m: "in", col, val: vals });
          return chain;
        },
        not: (col, notOp, val) => {
          filters.push({ m: "not", col, val: `${notOp}.${String(val)}` });
          return chain;
        },
        or: (expr) => {
          filters.push({ m: "or", val: expr });
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve(resolveQuery(table, op, patch, filters)),
        then: (onFulfilled, onRejected) =>
          Promise.resolve(resolveQuery(table, op, patch, filters)).then(
            onFulfilled,
            onRejected,
          ),
      };
      return chain;
    },
  };
}

import { undoImportRunAction } from "./actions";

function resetState(): void {
  state.run = { id: RUN_ID, team_id: TEAM_ID, undone_at: null };
  state.runFetchError = null;
  state.invoicedEntries = [];
  state.sameRunInvoices = [];
  state.importedCustomers = [];
  state.invoicesOnImportedCustomersCount = 0;
  state.importedProjects = [];
  state.manualEntries = [];
  state.manualProjects = [];
  state.cascadingProjects = [];
  state.writes = [];
  state.deleteError = null;
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({
    userId: fakeUserId,
    role: "owner",
  });
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function undoFd(overrides: Record<string, string> = {}): FormData {
  return fd({ run_id: RUN_ID, team_id: TEAM_ID, ...overrides });
}

function deletes(): RecordedWrite[] {
  return state.writes.filter((w) => w.op === "delete");
}

describe("undoImportRunAction — input validation & authz", () => {
  beforeEach(resetState);

  it("requires run_id and team_id", async () => {
    await expect(undoImportRunAction(fd({}))).rejects.toThrow(
      /run_id and team_id are required/,
    );
    expect(state.writes).toEqual([]);
  });

  it("rejects non-UUID ids before any query (filter-injection guard)", async () => {
    await expect(
      undoImportRunAction(
        fd({ run_id: "abc,import_run_id.eq.x)", team_id: TEAM_ID }),
      ),
    ).rejects.toThrow(/must be UUIDs/);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it("rejects a plain member — owner/admin only", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(undoImportRunAction(undoFd())).rejects.toThrow(
      /Only team owners and admins can undo import runs/,
    );
    expect(state.writes).toEqual([]);
  });

  it("throws when the run does not exist", async () => {
    state.run = null;
    await expect(undoImportRunAction(undoFd())).rejects.toThrow(
      /Import run not found/,
    );
    expect(state.writes).toEqual([]);
  });

  it("treats a fetch error the same as not-found (PostgREST { data: null, error })", async () => {
    state.run = null;
    state.runFetchError = { message: "boom", code: "500" };
    await expect(undoImportRunAction(undoFd())).rejects.toThrow(
      /Import run not found/,
    );
  });

  it("refuses when the run belongs to a different team (belt + suspenders on top of validateTeamAccess)", async () => {
    state.run = {
      id: RUN_ID,
      team_id: "33333333-3333-4333-8333-333333333333",
      undone_at: null,
    };
    await expect(undoImportRunAction(undoFd())).rejects.toThrow(
      /does not belong to this team/,
    );
    expect(state.writes).toEqual([]);
  });

  it("refuses a second undo of an already-undone run", async () => {
    state.run = {
      id: RUN_ID,
      team_id: TEAM_ID,
      undone_at: "2026-07-01T00:00:00+00:00",
    };
    await expect(undoImportRunAction(undoFd())).rejects.toThrow(
      /already been undone/,
    );
    expect(state.writes).toEqual([]);
  });
});

describe("undoImportRunAction — refusal checks", () => {
  beforeEach(resetState);

  it("blocks when imported entries are invoiced by an invoice OUTSIDE this run", async () => {
    state.invoicedEntries = [
      { id: "e1", invoice_id: "inv-foreign" },
      { id: "e2", invoice_id: "inv-foreign" },
    ];
    state.sameRunInvoices = []; // inv-foreign is not part of this run
    await expect(undoImportRunAction(undoFd())).rejects.toMatchObject({
      name: "AppError",
      code: "CONFLICT",
      severity: "info",
      message: invoicedEntriesRefusalMessage(2, 1),
    });
    expect(deletes()).toEqual([]);
  });

  it("does NOT block when the linked invoice was created by this same run", async () => {
    state.invoicedEntries = [{ id: "e1", invoice_id: "inv-own" }];
    state.sameRunInvoices = [{ id: "inv-own" }];
    await undoImportRunAction(undoFd());
    expect(deletes()).toHaveLength(7);
  });

  it("blocks when non-run invoices point at imported customers", async () => {
    state.importedCustomers = [{ id: "c1" }];
    state.invoicesOnImportedCustomersCount = 3;
    await expect(undoImportRunAction(undoFd())).rejects.toThrow(
      invoicesOnImportedCustomersRefusalMessage(3),
    );
    expect(deletes()).toEqual([]);
  });

  it("blocks when manual time entries live on imported projects (cascade would eat them)", async () => {
    state.importedProjects = [{ id: "p1" }, { id: "p2" }];
    state.manualEntries = [
      { project_id: "p1" },
      { project_id: "p1" },
      { project_id: "p2" },
    ];
    await expect(undoImportRunAction(undoFd())).rejects.toThrow(
      manualEntriesOnImportedProjectsRefusalMessage(3, 2),
    );
    expect(deletes()).toEqual([]);
  });

  it("blocks when manual projects are parented to imported customers", async () => {
    state.importedCustomers = [{ id: "c1" }];
    state.manualProjects = [{ customer_id: "c1" }];
    await expect(undoImportRunAction(undoFd())).rejects.toThrow(
      manualProjectsOnImportedCustomersRefusalMessage(1, 1),
    );
    expect(deletes()).toEqual([]);
  });

  it("force=true skips the manual-data refusals (#3 and #4) and proceeds", async () => {
    state.importedProjects = [{ id: "p1" }];
    state.manualEntries = [{ project_id: "p1" }];
    state.importedCustomers = [{ id: "c1" }];
    state.manualProjects = [{ customer_id: "c1" }];
    await undoImportRunAction(undoFd({ force: "true" }));
    expect(deletes()).toHaveLength(7);
  });

  it("force=true does NOT bypass the foreign-invoice refusal (#1) — that would crash the cascade", async () => {
    state.invoicedEntries = [{ id: "e1", invoice_id: "inv-foreign" }];
    state.sameRunInvoices = [];
    await expect(
      undoImportRunAction(undoFd({ force: "true" })),
    ).rejects.toThrow(invoicedEntriesRefusalMessage(1, 1));
    expect(deletes()).toEqual([]);
  });

  it("force=true does NOT bypass the invoices-on-imported-customers refusal (#2)", async () => {
    state.importedCustomers = [{ id: "c1" }];
    state.invoicesOnImportedCustomersCount = 1;
    await expect(
      undoImportRunAction(undoFd({ force: "true" })),
    ).rejects.toThrow(invoicesOnImportedCustomersRefusalMessage(1));
    expect(deletes()).toEqual([]);
  });
});

describe("undoImportRunAction — happy path & delete pipeline", () => {
  beforeEach(resetState);

  it("deletes in FK-safe order (invoices before projects) and each delete is team-scoped", async () => {
    await undoImportRunAction(undoFd());
    const d = deletes();
    expect(d.map((w) => w.table)).toEqual([
      "expenses",
      "time_entries",
      "invoices",
      "categories",
      "category_sets",
      "projects",
      "customers",
    ]);
    for (const w of d) {
      expect(has(w.filters, "eq", "import_run_id")).toBe(true);
      if (w.table !== "categories") {
        // categories has no team_id column; every other delete must
        // carry the team scope so a leaked run_id can't cross teams.
        expect(
          w.filters.find((f) => f.m === "eq" && f.col === "team_id")?.val,
        ).toBe(TEAM_ID);
      }
    }
  });

  it("marks the run undone (timestamp + acting user) after the deletes", async () => {
    await undoImportRunAction(undoFd());
    const runUpdate = state.writes.find(
      (w) => w.op === "update" && w.table === "import_runs",
    );
    expect(runUpdate?.patch).toMatchObject({
      undone_by_user_id: fakeUserId,
    });
    expect(typeof runUpdate?.patch?.undone_at).toBe("string");
    // The mark-undone write comes after all seven deletes.
    expect(state.writes.indexOf(runUpdate as RecordedWrite)).toBeGreaterThan(
      state.writes.indexOf(deletes()[6] as RecordedWrite),
    );
  });

  it("revalidates every surface the undo touched", async () => {
    await undoImportRunAction(undoFd());
    for (const p of [
      "/import",
      "/customers",
      "/projects",
      "/time-entries",
      "/invoices",
      "/business",
    ]) {
      expect(mockRevalidatePath).toHaveBeenCalledWith(p);
    }
  });

  it("propagates a delete failure as an AppError and never marks the run undone", async () => {
    state.deleteError = {
      table: "time_entries",
      error: { message: "lock-guard refused", code: "23514" },
    };
    await expect(undoImportRunAction(undoFd())).rejects.toMatchObject({
      name: "AppError",
      message: "lock-guard refused",
    });
    expect(
      state.writes.find((w) => w.op === "update" && w.table === "import_runs"),
    ).toBeUndefined();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("undoImportRunAction — force unlock pre-pass", () => {
  beforeEach(resetState);

  it("clears invoiced + invoice_id on entries under imported projects and cascading customer projects", async () => {
    state.importedProjects = [{ id: "p-imported" }];
    state.importedCustomers = [{ id: "c1" }];
    state.cascadingProjects = [{ id: "p-manual-under-c1" }];
    await undoImportRunAction(undoFd({ force: "true" }));

    const unlocks = state.writes.filter(
      (w) =>
        w.op === "update" &&
        w.table === "time_entries" &&
        w.patch?.invoiced === false &&
        w.patch?.invoice_id === null,
    );
    expect(unlocks).toHaveLength(2);
    expect(
      unlocks[0]?.filters.find((f) => f.m === "in" && f.col === "project_id")
        ?.val,
    ).toEqual(["p-imported"]);
    expect(
      unlocks[1]?.filters.find((f) => f.m === "in" && f.col === "project_id")
        ?.val,
    ).toEqual(["p-manual-under-c1"]);
    // Both scoped to entries that actually hold an invoice pointer.
    for (const u of unlocks) {
      expect(has(u.filters, "not", "invoice_id")).toBe(true);
    }
  });

  it("skips the unlock pre-pass entirely without force", async () => {
    state.importedProjects = [{ id: "p1" }];
    await undoImportRunAction(undoFd());
    expect(
      state.writes.filter(
        (w) => w.op === "update" && w.table === "time_entries",
      ),
    ).toEqual([]);
  });

  it("skips the unlock pre-pass when force run imported no projects or customers", async () => {
    await undoImportRunAction(undoFd({ force: "true" }));
    expect(
      state.writes.filter(
        (w) => w.op === "update" && w.table === "time_entries",
      ),
    ).toEqual([]);
    expect(deletes()).toHaveLength(7);
  });
});
