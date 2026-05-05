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

interface ProjectStub {
  id: string;
  team_id: string;
  customer_id: string | null;
  is_internal: boolean;
  default_billable: boolean;
}

interface InvoicedEntryStub {
  invoice_id: string;
}

interface InvoiceStub {
  id: string;
  invoice_number: string;
  status: "draft" | "sent" | "paid" | "void";
}

const state: {
  projects: Record<string, ProjectStub>;
  invoicedEntries: Record<string, InvoicedEntryStub[]>;
  invoices: InvoiceStub[];
  updates: { table: string; patch: Record<string, unknown>; where: Record<string, string | null> }[];
  bulkUpdates: {
    table: string;
    patch: Record<string, unknown>;
    where: Record<string, string | null>;
  }[];
} = {
  projects: {},
  invoicedEntries: {},
  invoices: [],
  updates: [],
  bulkUpdates: [],
};

function mockSupabase() {
  return {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => ({
      select: (_cols: string, _opts?: unknown) => ({
        eq: (col: string, val: string) => {
          if (table === "projects" && col === "id") {
            return {
              maybeSingle: () =>
                Promise.resolve({
                  data: state.projects[val] ?? null,
                  error: null,
                }),
              single: () =>
                Promise.resolve({
                  data: state.projects[val] ?? null,
                  error: null,
                }),
            };
          }
          if (table === "time_entries" && col === "project_id") {
            return {
              not: (_c: string, _op: string, _v: unknown) => ({
                limit: (_n: number) =>
                  Promise.resolve({
                    data: state.invoicedEntries[val] ?? [],
                    error: null,
                  }),
              }),
            };
          }
          throw new Error(`unexpected select.eq on ${table}.${col}`);
        },
        in: (col: string, vals: string[]) => {
          if (table === "invoices" && col === "id") {
            return {
              neq: (statusCol: string, voidVal: string) =>
                Promise.resolve({
                  data: state.invoices.filter(
                    (inv) =>
                      vals.includes(inv.id) &&
                      (inv as unknown as Record<string, unknown>)[statusCol] !==
                        voidVal,
                  ),
                  error: null,
                }),
            };
          }
          throw new Error(`unexpected select.in on ${table}.${col}`);
        },
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          // single-row update
          const result = {
            data: null,
            error: null,
          };
          // detect chained .is() calls (bulk update pattern)
          const chain = {
            is: (_c: string, _v: unknown) => chain,
            then: (resolve: (r: typeof result) => void) => {
              state.bulkUpdates.push({
                table,
                patch,
                where: { [col]: val },
              });
              resolve(result);
              return Promise.resolve(result);
            },
          };
          // support both `.eq(...)` (resolved) and `.eq(...).is(...).is(...)` chains
          const single = Promise.resolve(result);
          // attach the chain methods so the action's `.is().is()` keeps working
          (single as unknown as Record<string, unknown>).is = chain.is;
          state.updates.push({
            table,
            patch,
            where: { [col]: val },
          });
          return single;
        },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  setProjectInternalAction,
  applyDefaultBillableAction,
} from "./actions";

function resetState(): void {
  state.projects = {};
  state.invoicedEntries = {};
  state.invoices = [];
  state.updates = [];
  state.bulkUpdates = [];
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("setProjectInternalAction — flip to internal", () => {
  beforeEach(resetState);

  it("nulls customer_id, sets default_billable=false, and marks internal", async () => {
    state.projects["p1"] = {
      id: "p1",
      team_id: "t1",
      customer_id: "c1",
      is_internal: false,
      default_billable: true,
    };
    await setProjectInternalAction(fd({ id: "p1", target: "internal" }));
    const u = state.updates.find((x) => x.table === "projects");
    expect(u?.patch).toEqual({
      is_internal: true,
      customer_id: null,
      default_billable: false,
    });
    expect(u?.where).toEqual({ id: "p1" });
  });

  it("blocks the flip when the project has draft-invoice references", async () => {
    state.projects["p1"] = {
      id: "p1",
      team_id: "t1",
      customer_id: "c1",
      is_internal: false,
      default_billable: true,
    };
    state.invoicedEntries["p1"] = [{ invoice_id: "inv-1" }];
    state.invoices = [
      { id: "inv-1", invoice_number: "INV-001", status: "draft" },
    ];
    await expect(
      setProjectInternalAction(fd({ id: "p1", target: "internal" })),
    ).rejects.toThrow(/INV-001/);
    expect(state.updates).toHaveLength(0);
  });

  it("permits the flip when invoice references are all void", async () => {
    state.projects["p1"] = {
      id: "p1",
      team_id: "t1",
      customer_id: "c1",
      is_internal: false,
      default_billable: true,
    };
    state.invoicedEntries["p1"] = [{ invoice_id: "inv-1" }];
    state.invoices = [
      { id: "inv-1", invoice_number: "INV-001", status: "void" },
    ];
    await setProjectInternalAction(fd({ id: "p1", target: "internal" }));
    const u = state.updates.find((x) => x.table === "projects");
    expect(u?.patch.is_internal).toBe(true);
  });
});

describe("setProjectInternalAction — flip to client work", () => {
  beforeEach(resetState);

  it("sets customer_id and clears the internal flag", async () => {
    state.projects["p1"] = {
      id: "p1",
      team_id: "t1",
      customer_id: null,
      is_internal: true,
      default_billable: false,
    };
    await setProjectInternalAction(
      fd({ id: "p1", target: "client_work", customer_id: "c2" }),
    );
    const u = state.updates.find((x) => x.table === "projects");
    expect(u?.patch).toEqual({
      is_internal: false,
      customer_id: "c2",
    });
  });

  it("rejects flip-to-client without a customer_id", async () => {
    state.projects["p1"] = {
      id: "p1",
      team_id: "t1",
      customer_id: null,
      is_internal: true,
      default_billable: false,
    };
    await expect(
      setProjectInternalAction(fd({ id: "p1", target: "client_work" })),
    ).rejects.toThrow(/Pick a customer/);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects an invalid target", async () => {
    state.projects["p1"] = {
      id: "p1",
      team_id: "t1",
      customer_id: "c1",
      is_internal: false,
      default_billable: true,
    };
    await expect(
      setProjectInternalAction(fd({ id: "p1", target: "garbage" })),
    ).rejects.toThrow(/Invalid target/);
  });
});

describe("applyDefaultBillableAction", () => {
  beforeEach(resetState);

  it("propagates the project's default_billable to existing entries", async () => {
    state.projects["p1"] = {
      id: "p1",
      team_id: "t1",
      customer_id: "c1",
      is_internal: false,
      default_billable: false,
    };
    await applyDefaultBillableAction(fd({ project_id: "p1" }));
    const u = state.updates.find((x) => x.table === "time_entries");
    expect(u?.patch).toEqual({ billable: false });
    expect(u?.where).toEqual({ project_id: "p1" });
  });

  it("uses true when the project's default_billable is true", async () => {
    state.projects["p1"] = {
      id: "p1",
      team_id: "t1",
      customer_id: "c1",
      is_internal: false,
      default_billable: true,
    };
    await applyDefaultBillableAction(fd({ project_id: "p1" }));
    const u = state.updates.find((x) => x.table === "time_entries");
    expect(u?.patch).toEqual({ billable: true });
  });

  it("requires a project_id", async () => {
    await expect(applyDefaultBillableAction(fd({}))).rejects.toThrow(
      /Project id is required/,
    );
    expect(state.updates).toHaveLength(0);
  });

  it("throws when the project doesn't exist", async () => {
    await expect(
      applyDefaultBillableAction(fd({ project_id: "missing" })),
    ).rejects.toThrow(/Project not found/);
    expect(state.updates).toHaveLength(0);
  });
});
