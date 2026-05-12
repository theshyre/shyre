import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Broader coverage for projects/actions.ts (944 lines, 11 mutation
 * actions). The pre-existing actions.test.ts focuses tightly on rate
 * gating. This file extends to the other actions:
 *
 *   - createProject: customer-XOR-internal, rate parse, key validation
 *   - updateProject: internal-projects-skip-default_billable, budget
 *     threshold validation, parent-detach
 *   - setProjectInternal: target enum, refusal on locked invoices,
 *     atomic customer NULL
 *   - applyDefaultBillable: scoped UPDATE
 *   - bulkArchive / bulkRestore: empty-input + IN() scope
 *
 * Each action gets ~3 tests covering the most important invariants.
 * The remaining actions (setProjectRate, setProjectTimeEntriesVisibility,
 * upsertProjectCategories, deleteProjectCategories, bulkSwitchCategorySet,
 * getProjectHistory) are intentionally NOT covered here — they either
 * have their own coverage already (rate gating in actions.test.ts) or
 * require deeper fixtures (RPCs + read-only history merge).
 */

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
vi.mock("@/lib/team-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/team-context")>(
    "@/lib/team-context",
  );
  return {
    ...actual,
    validateTeamAccess: (teamId: string) =>
      mockValidateTeamAccess(teamId),
  };
});

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const state: {
  rpcResponses: Record<string, unknown>;
  rpcCalls: RpcCall[];
  projectRow:
    | {
        id?: string;
        team_id?: string;
        customer_id?: string | null;
        is_internal?: boolean;
        default_billable?: boolean;
        jira_project_key?: string | null;
      }
    | null;
  invoicedRows: Array<{ invoice_id: string | null }>;
  blockingInvoices: Array<{
    id: string;
    invoice_number: string;
    status: string;
  }>;
  inserts: { table: string; rows: unknown }[];
  updates: { table: string; patch: unknown; filters: Filter[] }[];
} = {
  rpcResponses: {},
  rpcCalls: [],
  projectRow: null,
  invoicedRows: [],
  blockingInvoices: [],
  inserts: [],
  updates: [],
};

function mockSupabase() {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({
        data: state.rpcResponses[name],
        error: null,
      });
    },
    from: (table: string) => tableChain(table),
  };
}

function tableChain(table: string) {
  type Op =
    | { kind: "select"; cols: string }
    | { kind: "insert"; rows: unknown }
    | { kind: "update"; patch: unknown }
    | { kind: "delete" };
  const op: { current: Op | null; filters: Filter[] } = {
    current: null,
    filters: [],
  };
  const chain: Record<string, unknown> = {
    select(cols: string) {
      op.current = { kind: "select", cols };
      return chain;
    },
    insert(rows: unknown) {
      op.current = { kind: "insert", rows };
      state.inserts.push({ table, rows });
      const insertChain: Record<string, unknown> = {
        then: (resolve: (v: { data: null; error: null }) => void) => {
          resolve({ data: null, error: null });
        },
      };
      return insertChain;
    },
    update(patch: unknown) {
      op.current = { kind: "update", patch };
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
    neq(col: string, value: unknown) {
      op.filters.push({ col, op: "neq", value });
      return chain;
    },
    limit() {
      return chain;
    },
    maybeSingle() {
      if (table === "projects") {
        return Promise.resolve({ data: state.projectRow, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (v: { data: unknown; error: null }) => void) {
      if (op.current?.kind === "update") {
        state.updates.push({
          table,
          patch: op.current.patch,
          filters: [...op.filters],
        });
        resolve({ data: null, error: null });
        return;
      }
      if (op.current?.kind === "select") {
        if (table === "time_entries") {
          resolve({ data: state.invoicedRows, error: null });
          return;
        }
        if (table === "invoices") {
          resolve({ data: state.blockingInvoices, error: null });
          return;
        }
      }
      resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  applyDefaultBillableAction,
  bulkArchiveProjectsAction,
  bulkRestoreProjectsAction,
  createProjectAction,
  setProjectInternalAction,
  updateProjectAction,
} from "./actions";

function reset(): void {
  state.rpcResponses = {};
  state.rpcCalls = [];
  state.projectRow = null;
  state.invoicedRows = [];
  state.blockingInvoices = [];
  state.inserts = [];
  state.updates = [];
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) {
      for (const one of v) f.append(k, one);
    } else {
      f.set(k, v);
    }
  }
  return f;
}

describe("createProjectAction", () => {
  beforeEach(reset);

  it("inserts a project with team + user stamps; revalidates /projects + the customer page", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await createProjectAction(
      fd({
        team_id: "t-1",
        customer_id: "c-1",
        name: "API rewrite",
        hourly_rate: "175",
        budget_hours: "40",
      }),
    );
    expect(state.inserts).toHaveLength(1);
    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.team_id).toBe("t-1");
    expect(row.user_id).toBe(fakeUserId);
    expect(row.customer_id).toBe("c-1");
    expect(row.is_internal).toBe(false);
    expect(row.default_billable).toBe(true);
    expect(row.hourly_rate).toBe(175);
    expect(row.budget_hours).toBe(40);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/projects");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c-1");
  });

  it("rejects external project without a customer", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await expect(
      createProjectAction(fd({ team_id: "t-1", name: "Orphan" })),
    ).rejects.toThrow(/Pick a customer.*internal/);
    expect(state.inserts).toHaveLength(0);
  });

  it("internal project NULLs the customer + forces default_billable=false even if user submitted contradictory values", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await createProjectAction(
      fd({
        team_id: "t-1",
        name: "Internal tooling",
        is_internal: "on",
        customer_id: "c-bogus",
        default_billable: "on",
      }),
    );
    const row = state.inserts[0]?.rows as Record<string, unknown>;
    expect(row.is_internal).toBe(true);
    expect(row.customer_id).toBeNull();
    expect(row.default_billable).toBe(false);
  });

  it("normalizes jira_project_key to uppercase", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await createProjectAction(
      fd({
        team_id: "t-1",
        customer_id: "c-1",
        name: "Bug fix",
        jira_project_key: "proj",
      }),
    );
    expect(
      (state.inserts[0]?.rows as Record<string, unknown>).jira_project_key,
    ).toBe("PROJ");
  });

  it("rejects malformed jira_project_key (1 char)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await expect(
      createProjectAction(
        fd({
          team_id: "t-1",
          customer_id: "c-1",
          name: "Bug fix",
          jira_project_key: "x",
        }),
      ),
    ).rejects.toThrow(/Jira project key/);
  });

  it("rejects malformed invoice_code (starts with digit)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await expect(
      createProjectAction(
        fd({
          team_id: "t-1",
          customer_id: "c-1",
          name: "Bug fix",
          invoice_code: "123ABC",
        }),
      ),
    ).rejects.toThrow(/Invoice code/);
  });
});

describe("updateProjectAction — beyond the rate guardrail (which actions.test.ts already covers)", () => {
  beforeEach(reset);

  it("skips default_billable on internal projects", async () => {
    state.projectRow = { is_internal: true };
    await updateProjectAction(
      fd({
        id: "p-1",
        name: "Internal proj",
        status: "active",
        default_billable: "on",
      }),
    );
    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch).not.toHaveProperty("default_billable");
  });

  it("writes default_billable on external projects", async () => {
    state.projectRow = { is_internal: false };
    await updateProjectAction(
      fd({
        id: "p-1",
        name: "Acme work",
        status: "active",
        default_billable: "off",
      }),
    );
    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.default_billable).toBe(false);
  });

  it("rejects budget_alert_threshold_pct outside 1..100", async () => {
    state.rpcResponses["can_set_project_rate"] = true;
    await expect(
      updateProjectAction(
        fd({
          id: "p-1",
          name: "Bug fix",
          status: "active",
          budget_alert_threshold_pct: "150",
        }),
      ),
    ).rejects.toThrow(/Alert threshold/);
  });

  it("rejects unknown budget_period values", async () => {
    state.rpcResponses["can_set_project_rate"] = true;
    await expect(
      updateProjectAction(
        fd({
          id: "p-1",
          name: "Bug fix",
          status: "active",
          budget_period: "fortnightly",
        }),
      ),
    ).rejects.toThrow(/budget period/);
  });

  it("rejects unknown budget_carryover values", async () => {
    state.rpcResponses["can_set_project_rate"] = true;
    await expect(
      updateProjectAction(
        fd({
          id: "p-1",
          name: "Bug fix",
          status: "active",
          budget_carryover: "infinite_glory",
        }),
      ),
    ).rejects.toThrow(/budget carryover/);
  });

  it("parent_project_id empty string normalizes to null (detach from parent)", async () => {
    await updateProjectAction(
      fd({
        id: "p-1",
        name: "Bug fix",
        status: "active",
        parent_project_id: "",
      }),
    );
    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.parent_project_id).toBeNull();
  });
});

describe("setProjectInternalAction", () => {
  beforeEach(reset);

  it("rejects an unknown target value", async () => {
    await expect(
      setProjectInternalAction(fd({ id: "p-1", target: "yolo" })),
    ).rejects.toThrow(/Invalid target/);
  });

  it("rejects when the project doesn't exist", async () => {
    state.projectRow = null;
    await expect(
      setProjectInternalAction(fd({ id: "p-1", target: "internal" })),
    ).rejects.toThrow(/Project not found/);
  });

  it("target=internal blocks when entries are locked to non-void invoices", async () => {
    state.projectRow = {
      id: "p-1",
      team_id: "t-1",
      customer_id: "c-1",
      is_internal: false,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    state.invoicedRows = [{ invoice_id: "inv-1" }];
    state.blockingInvoices = [
      { id: "inv-1", invoice_number: "INV-001", status: "sent" },
    ];
    await expect(
      setProjectInternalAction(fd({ id: "p-1", target: "internal" })),
    ).rejects.toThrow(/INV-001/);
    expect(state.updates).toHaveLength(0);
  });

  it("target=internal nulls customer_id + sets default_billable=false", async () => {
    state.projectRow = {
      id: "p-1",
      team_id: "t-1",
      customer_id: "c-1",
      is_internal: false,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await setProjectInternalAction(fd({ id: "p-1", target: "internal" }));
    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.is_internal).toBe(true);
    expect(patch.customer_id).toBeNull();
    expect(patch.default_billable).toBe(false);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c-1");
  });

  it("target=client_work requires a customer_id", async () => {
    state.projectRow = {
      id: "p-1",
      team_id: "t-1",
      customer_id: null,
      is_internal: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await expect(
      setProjectInternalAction(fd({ id: "p-1", target: "client_work" })),
    ).rejects.toThrow(/Pick a customer/);
  });

  it("target=client_work writes is_internal=false + the new customer", async () => {
    state.projectRow = {
      id: "p-1",
      team_id: "t-1",
      customer_id: null,
      is_internal: true,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await setProjectInternalAction(
      fd({ id: "p-1", target: "client_work", customer_id: "c-2" }),
    );
    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.is_internal).toBe(false);
    expect(patch.customer_id).toBe("c-2");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c-2");
  });
});

describe("applyDefaultBillableAction", () => {
  beforeEach(reset);

  it("rejects missing project id", async () => {
    await expect(applyDefaultBillableAction(fd({}))).rejects.toThrow(
      /Project id/,
    );
  });

  it("updates billable scoped to project + null invoice + null deleted_at (locked rows untouched)", async () => {
    state.projectRow = {
      id: "p-1",
      team_id: "t-1",
      default_billable: false,
    };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    await applyDefaultBillableAction(fd({ project_id: "p-1" }));
    const u = state.updates.find((u) => u.table === "time_entries");
    expect(u).toBeDefined();
    expect((u?.patch as Record<string, unknown>).billable).toBe(false);
    expect(u?.filters).toContainEqual({
      col: "project_id",
      op: "eq",
      value: "p-1",
    });
    expect(u?.filters).toContainEqual({
      col: "invoice_id",
      op: "is",
      value: null,
    });
    expect(u?.filters).toContainEqual({
      col: "deleted_at",
      op: "is",
      value: null,
    });
  });

  it("rejects when the project doesn't exist", async () => {
    state.projectRow = null;
    await expect(
      applyDefaultBillableAction(fd({ project_id: "p-nope" })),
    ).rejects.toThrow(/Project not found/);
  });
});

describe("bulkArchiveProjectsAction", () => {
  beforeEach(reset);

  it("returns silently on empty input (no UPDATE)", async () => {
    await bulkArchiveProjectsAction(fd({}));
    expect(state.updates).toHaveLength(0);
  });

  it("sets status='archived' on selected ids in one IN() query", async () => {
    await bulkArchiveProjectsAction(fd({ id: ["p-1", "p-2", "p-3"] }));
    const u = state.updates.find((u) => u.table === "projects");
    expect(u).toBeDefined();
    expect((u?.patch as Record<string, unknown>).status).toBe("archived");
    expect(u?.filters).toContainEqual({
      col: "id",
      op: "in",
      value: ["p-1", "p-2", "p-3"],
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/projects");
  });

  it("filters out empty-string ids defensively", async () => {
    await bulkArchiveProjectsAction(fd({ id: ["", "p-1", ""] }));
    const u = state.updates.find((u) => u.table === "projects");
    expect(u?.filters).toContainEqual({
      col: "id",
      op: "in",
      value: ["p-1"],
    });
  });
});

describe("bulkRestoreProjectsAction", () => {
  beforeEach(reset);

  it("returns silently on empty input", async () => {
    await bulkRestoreProjectsAction(fd({}));
    expect(state.updates).toHaveLength(0);
  });

  it("sets status='active' on the selected ids", async () => {
    await bulkRestoreProjectsAction(fd({ id: ["p-1", "p-2"] }));
    const u = state.updates.find((u) => u.table === "projects");
    expect(u).toBeDefined();
    expect((u?.patch as Record<string, unknown>).status).toBe("active");
    expect(u?.filters).toContainEqual({
      col: "id",
      op: "in",
      value: ["p-1", "p-2"],
    });
  });
});
