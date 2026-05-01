import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock runSafeAction to strip the auth boundary.
// safe-action.test.ts already covers the auth wrap — here we care about
// the inside: orchestration, DB calls, totals, and side effects.
const fakeUserId = "u-author";
vi.mock("@/lib/safe-action", () => ({
  runSafeAction: async (
    formData: FormData,
    fn: (fd: FormData, ctx: { supabase: unknown; userId: string }) => Promise<void>,
  ) => {
    await fn(formData, { supabase: mockSupabase(), userId: fakeUserId });
    return { success: true };
  },
}));

// validateTeamAccess — stubbed to succeed and return the caller's role.
const mockValidateTeamAccess = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (...args: unknown[]) => mockValidateTeamAccess(...args),
}));

// revalidatePath + redirect — observed but inert.
const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const mockRedirect = vi.fn((path: string): never => {
  const err = new Error(`NEXT_REDIRECT ${path}`) as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};307;`;
  throw err;
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

// --- Mock supabase client.
// Shape: from(table) returns a chain of .select() / .eq() / .insert() / .update() /
// .single(), with a terminal that resolves to { data, error }. Tests mutate
// `tables` and `inserts` before invoking the action.

interface TimeEntry {
  id: string;
  duration_min: number | null;
  description: string | null;
  user_id?: string;
  projects: {
    name: string;
    hourly_rate: number | null;
    customer_id: string | null;
    customers: { default_rate: number | null } | null;
  } | null;
}

interface Settings {
  invoice_prefix: string | null;
  invoice_next_num: number;
  default_rate: number | null;
}

interface TeamMemberRate {
  user_id: string;
  default_rate: number | null;
}

interface FetchedInvoice {
  team_id: string;
  status: string;
}

const state: {
  timeEntries: TimeEntry[];
  settings: Settings | null;
  memberRates: TeamMemberRate[];
  invoiceIdToInsert: string;
  inserts: { table: string; rows: unknown }[];
  updates: { table: string; patch: unknown; where: Record<string, string | string[]> }[];
  insertShouldError: boolean;
  /** What `.from("invoices").select("team_id, status").eq("id", _).maybeSingle()`
   *  resolves to. The tightened `updateInvoiceStatusAction` reads this
   *  before the role check + transition guard. */
  fetchedInvoice: FetchedInvoice | null;
} = {
  timeEntries: [],
  settings: null,
  memberRates: [],
  invoiceIdToInsert: "inv-1",
  inserts: [],
  updates: [],
  insertShouldError: false,
  fetchedInvoice: null,
};

function mockSupabase() {
  function fromTable(table: string): unknown {
    if (table === "team_settings") {
      return settingsChain();
    }
    if (table === "time_entries") {
      return timeEntriesChain();
    }
    if (table === "team_members") {
      return teamMembersChain();
    }
    if (table === "invoices") {
      return invoicesChain();
    }
    if (table === "invoice_line_items") {
      return lineItemsChain();
    }
    throw new Error(`unexpected table ${table}`);
  }

  function teamMembersChain() {
    // Used for the per-member default_rate cascade layer. Tests populate
    // state.memberRates; the chain ignores filter args because the
    // production code only filters by team_id and tests set memberRates
    // scoped to the team under test.
    const q = {
      select: () => q,
      eq: () => q,
      then: (resolve: (v: { data: TeamMemberRate[] }) => void) => {
        resolve({ data: state.memberRates });
      },
    };
    return q;
  }

  function settingsChain() {
    const q = {
      select: () => q,
      eq: () => q,
      single: () => Promise.resolve({ data: state.settings }),
      update: (patch: unknown) => ({
        eq: (col: string, val: string) => {
          state.updates.push({
            table: "team_settings",
            patch,
            where: { [col]: val },
          });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
    return q;
  }

  function timeEntriesChain() {
    // The query chain accumulates filters but we don't use them — the test
    // controls which entries live in state.timeEntries.
    const q = {
      select: () => q,
      eq: () => q,
      not: () => q,
      is: () => q,
      update: (patch: unknown) => ({
        in: (col: string, vals: string[]) => {
          state.updates.push({
            table: "time_entries",
            patch,
            where: { [col]: vals },
          });
          return Promise.resolve({ data: null, error: null });
        },
      }),
      then: (resolve: (v: { data: TimeEntry[] }) => void) => {
        resolve({ data: state.timeEntries });
      },
    };
    return q;
  }

  function invoicesChain() {
    return {
      insert: (rows: unknown) => {
        state.inserts.push({ table: "invoices", rows });
        return {
          select: () => ({
            single: () =>
              state.insertShouldError
                ? Promise.resolve({
                    data: null,
                    error: { message: "insert failed", code: "X" },
                  })
                : Promise.resolve({
                    data: { id: state.invoiceIdToInsert },
                    error: null,
                  }),
          }),
        };
      },
      // Read path: select("team_id, status").eq("id", id).maybeSingle()
      // The tightened updateInvoiceStatusAction uses this to look up
      // the row's team and current status before role + transition
      // checks.
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: () =>
            Promise.resolve({ data: state.fetchedInvoice, error: null }),
        }),
      }),
      update: (patch: unknown) => ({
        eq: (col: string, val: string) => {
          state.updates.push({
            table: "invoices",
            patch,
            where: { [col]: val },
          });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
  }

  function lineItemsChain() {
    return {
      insert: (rows: unknown) => {
        state.inserts.push({ table: "invoice_line_items", rows });
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  return { from: fromTable };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  createInvoiceAction,
  updateInvoiceStatusAction,
} from "./actions";

function resetState() {
  state.timeEntries = [];
  state.settings = null;
  state.memberRates = [];
  state.invoiceIdToInsert = "inv-1";
  state.inserts = [];
  state.updates = [];
  state.insertShouldError = false;
  state.fetchedInvoice = null;
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
  mockRedirect.mockClear();
}

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updateInvoiceStatusAction", () => {
  beforeEach(resetState);

  it("transitions draft → sent (legal); revalidates list + detail", async () => {
    state.fetchedInvoice = { team_id: "team-1", status: "draft" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });

    await updateInvoiceStatusAction(fd({ id: "inv-7", status: "sent" }));

    expect(mockValidateTeamAccess).toHaveBeenCalledWith("team-1");
    expect(state.updates).toContainEqual({
      table: "invoices",
      patch: { status: "sent" },
      where: { id: "inv-7" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/invoices");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/invoices/inv-7");
  });

  it("rejects paid → draft (illegal transition; DB CHECK doesn't catch this)", async () => {
    state.fetchedInvoice = { team_id: "team-1", status: "paid" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });

    await expect(
      updateInvoiceStatusAction(fd({ id: "inv-7", status: "draft" })),
    ).rejects.toThrow(/not allowed/);
    expect(state.updates).toEqual([]);
  });

  it("rejects sent → paid for a plain member (only owner|admin)", async () => {
    state.fetchedInvoice = { team_id: "team-1", status: "sent" };
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "member" });

    await expect(
      updateInvoiceStatusAction(fd({ id: "inv-7", status: "paid" })),
    ).rejects.toThrow(/owner.*admin/i);
    expect(state.updates).toEqual([]);
  });

  it("returns 'not found' when the invoice id is bad — before any role check", async () => {
    state.fetchedInvoice = null;

    await expect(
      updateInvoiceStatusAction(fd({ id: "missing", status: "sent" })),
    ).rejects.toThrow(/not found/i);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
  });

  it("requires id and status; surfaces a clear error when missing", async () => {
    await expect(updateInvoiceStatusAction(fd({}))).rejects.toThrow(/required/i);
  });
});

describe("createInvoiceAction", () => {
  beforeEach(resetState);

  it("validates team access before touching any invoice table", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 42,
      default_rate: 100,
    };
    state.timeEntries = [
      {
        id: "t1",
        duration_min: 60,
        description: "work",
        projects: {
          name: "Proj A",
          hourly_rate: 100,
          customer_id: "c1",
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect throws; expected
    }
    expect(mockValidateTeamAccess).toHaveBeenCalledWith("team-1");
  });

  it("throws when there are no unbilled entries (no invoice / no redirect)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 150,
    };
    state.timeEntries = [];
    // In production this error is caught by runSafeAction and returned as
    // { success: false }; in this unit test we bypass that wrapper, so the
    // throw propagates here.
    await expect(
      createInvoiceAction(fd({ team_id: "team-1" })),
    ).rejects.toThrow(/No unbilled time entries/);
    expect(state.inserts.find((i) => i.table === "invoices")).toBeUndefined();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("builds line items using project rate first, customer default second, team default last", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 50, // team default
    };
    state.timeEntries = [
      // Project rate takes priority
      {
        id: "e1",
        duration_min: 60,
        description: "work 1",
        projects: {
          name: "P1",
          hourly_rate: 200,
          customer_id: "c1",
          customers: { default_rate: 120 },
        },
      },
      // No project rate → customer default
      {
        id: "e2",
        duration_min: 30,
        description: "work 2",
        projects: {
          name: "P2",
          hourly_rate: null,
          customer_id: "c1",
          customers: { default_rate: 120 },
        },
      },
      // No project rate, no customer → team default
      {
        id: "e3",
        duration_min: 120,
        description: "work 3",
        projects: {
          name: "P3",
          hourly_rate: null,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    const lineInsert = state.inserts.find(
      (i) => i.table === "invoice_line_items",
    );
    expect(lineInsert).toBeDefined();
    const rows = lineInsert?.rows as Array<{
      description: string;
      unit_price: number;
      quantity: number;
    }>;
    expect(rows).toHaveLength(3);
    // e1: 1hr × 200 from project rate
    expect(rows[0]?.unit_price).toBe(200);
    // e2: 0.5hr × 120 from customer default
    expect(rows[1]?.unit_price).toBe(120);
    // e3: 2hr × 50 from team default
    expect(rows[2]?.unit_price).toBe(50);
  });

  it("filters to the selected customer when customer_id is in the form", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 100,
    };
    state.timeEntries = [
      {
        id: "keep",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: "target",
          customers: null,
        },
      },
      {
        id: "skip",
        duration_min: 60,
        description: "b",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: "other",
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(
        fd({ team_id: "team-1", customer_id: "target" }),
      );
    } catch {
      // redirect
    }
    const lineInsert = state.inserts.find(
      (i) => i.table === "invoice_line_items",
    );
    const rows = lineInsert?.rows as Array<{ time_entry_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.time_entry_id).toBe("keep");
  });

  it("computes subtotal / tax / total correctly and writes them on the invoice row", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 100,
    };
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(
        fd({ team_id: "team-1", tax_rate: "10" }),
      );
    } catch {
      // redirect
    }
    const inv = state.inserts.find((i) => i.table === "invoices");
    const row = inv?.rows as {
      subtotal: number;
      tax_rate: number;
      tax_amount: number;
      total: number;
      invoice_number: string;
      user_id: string;
      team_id: string;
    };
    expect(row.subtotal).toBe(100);
    expect(row.tax_rate).toBe(10);
    expect(row.tax_amount).toBe(10);
    expect(row.total).toBe(110);
    // Format: `{prefix}-{year}-{nextNum:3}` per generateInvoiceNumber.
    expect(row.invoice_number).toMatch(/^INV-\d{4}-001$/);
    expect(row.user_id).toBe(fakeUserId);
    expect(row.team_id).toBe("team-1");
  });

  it("defaults tax to 0 when tax_rate is not in the form", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 100,
    };
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    const inv = state.inserts.find((i) => i.table === "invoices");
    const row = inv?.rows as { tax_rate: number; tax_amount: number };
    expect(row.tax_rate).toBe(0);
    expect(row.tax_amount).toBe(0);
  });

  it("uses default prefix 'INV' and start num 1 when team has no settings row", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = null;
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    const inv = state.inserts.find((i) => i.table === "invoices");
    expect(
      (inv?.rows as { invoice_number: string }).invoice_number,
    ).toMatch(/^INV-\d{4}-001$/);
  });

  it("marks the invoiced time entries and increments invoice_next_num", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 9,
      default_rate: 100,
    };
    state.invoiceIdToInsert = "inv-new";
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
      {
        id: "e2",
        duration_min: 30,
        description: "b",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    const entryUpdate = state.updates.find(
      (u) => u.table === "time_entries",
    );
    expect(entryUpdate?.patch).toEqual({
      invoiced: true,
      invoice_id: "inv-new",
    });
    expect(entryUpdate?.where.id).toEqual(["e1", "e2"]);

    const counterUpdate = state.updates.find(
      (u) => u.table === "team_settings",
    );
    expect(counterUpdate?.patch).toEqual({ invoice_next_num: 10 });
  });

  it("revalidates /invoices + /time-entries and redirects to the new invoice detail", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 100,
    };
    state.invoiceIdToInsert = "inv-fresh";
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    expect(mockRevalidatePath).toHaveBeenCalledWith("/invoices");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/time-entries");
    expect(mockRedirect).toHaveBeenCalledWith("/invoices/inv-fresh");
  });

  it("detailed grouping preserves the entry description as the line label", async () => {
    // Pre-redesign behavior was a hardcoded "Project: description"
    // prefix on every line. After the Harvest-style redesign the
    // user picks a grouping mode and lines render accordingly:
    // detailed → entry description; by_project → project name.
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 100,
    };
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "implement the feature",
        projects: {
          name: "Alpha",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(
        fd({ team_id: "team-1", grouping_mode: "detailed" }),
      );
    } catch {
      // redirect
    }
    const lineInsert = state.inserts.find(
      (i) => i.table === "invoice_line_items",
    );
    const rows = lineInsert?.rows as Array<{ description: string }>;
    expect(rows[0]?.description).toBe("implement the feature");
  });

  it("uses a project-only description when the time entry has no description", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 100,
    };
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: null,
        projects: {
          name: "Alpha",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    const lineInsert = state.inserts.find(
      (i) => i.table === "invoice_line_items",
    );
    const rows = lineInsert?.rows as Array<{ description: string }>;
    expect(rows[0]?.description).toBe("Alpha");
  });

  it("rejects a plain member (role='member') — only owner/admin can invoice", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 100,
    };
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "x",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    await expect(
      createInvoiceAction(fd({ team_id: "team-1" })),
    ).rejects.toThrow(/Only owners and admins can create invoices/);
    expect(state.inserts.find((i) => i.table === "invoices")).toBeUndefined();
  });

  it("admins can create invoices (role='admin' passes the gate)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 100,
    };
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "x",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect — expected on success path
    }
    expect(state.inserts.find((i) => i.table === "invoices")).toBeDefined();
  });

  it("cascade uses team_members.default_rate when no project and no customer rate is set", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 30, // team default (last fallback)
    };
    // Carol has a per-member default rate of 175. Her entry has no project
    // rate and no customer rate — cascade should resolve to 175 (above
    // the team default of 30).
    state.memberRates = [{ user_id: "u-carol", default_rate: 175 }];
    state.timeEntries = [
      {
        id: "e-carol",
        duration_min: 60,
        description: "carol work",
        user_id: "u-carol",
        projects: {
          name: "Internal",
          hourly_rate: null,
          customer_id: null,
          customers: null,
        },
      },
      // Bob has no per-member rate → should fall through to team default 30.
      {
        id: "e-bob",
        duration_min: 60,
        description: "bob work",
        user_id: "u-bob",
        projects: {
          name: "Internal",
          hourly_rate: null,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    const lineInsert = state.inserts.find(
      (i) => i.table === "invoice_line_items",
    );
    const rows = lineInsert?.rows as Array<{
      unit_price: number;
      time_entry_id: string;
    }>;
    expect(rows).toHaveLength(2);
    const carolRow = rows.find((r) => r.time_entry_id === "e-carol");
    const bobRow = rows.find((r) => r.time_entry_id === "e-bob");
    expect(carolRow?.unit_price).toBe(175); // member rate wins
    expect(bobRow?.unit_price).toBe(30); // no member rate → team default
  });

  it("payment_terms_days: persists days + denormalized label", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(
        fd({ team_id: "team-1", payment_terms_days: "30" }),
      );
    } catch {
      // redirect
    }
    const inv = state.inserts.find((i) => i.table === "invoices");
    const row = inv?.rows as {
      payment_terms_days: number | null;
      payment_terms_label: string | null;
    };
    expect(row.payment_terms_days).toBe(30);
    expect(row.payment_terms_label).toBe("Net 30");
  });

  it("payment_terms_days: 0 maps to 'Due on receipt'", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(
        fd({ team_id: "team-1", payment_terms_days: "0" }),
      );
    } catch {
      // redirect
    }
    const inv = state.inserts.find((i) => i.table === "invoices");
    const row = inv?.rows as {
      payment_terms_days: number | null;
      payment_terms_label: string | null;
    };
    expect(row.payment_terms_days).toBe(0);
    expect(row.payment_terms_label).toBe("Due on receipt");
  });

  it("payment_terms_days: empty / missing → both null (legacy unset)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    const inv = state.inserts.find((i) => i.table === "invoices");
    const row = inv?.rows as {
      payment_terms_days: number | null;
      payment_terms_label: string | null;
    };
    expect(row.payment_terms_days).toBeNull();
    expect(row.payment_terms_label).toBeNull();
  });

  it("payment_terms_days: clamps out-of-range values to 0..365", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.timeEntries = [
      {
        id: "e1",
        duration_min: 60,
        description: "a",
        projects: {
          name: "P",
          hourly_rate: 100,
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(
        fd({ team_id: "team-1", payment_terms_days: "9999" }),
      );
    } catch {
      // redirect
    }
    const inv = state.inserts.find((i) => i.table === "invoices");
    const row = inv?.rows as {
      payment_terms_days: number | null;
      payment_terms_label: string | null;
    };
    expect(row.payment_terms_days).toBe(365);
    expect(row.payment_terms_label).toBe("Net 365");
  });

  it("cascade: project rate still beats the per-member rate", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    state.settings = {
      invoice_prefix: "INV",
      invoice_next_num: 1,
      default_rate: 30,
    };
    state.memberRates = [{ user_id: "u-carol", default_rate: 175 }];
    state.timeEntries = [
      {
        id: "e",
        duration_min: 60,
        description: "x",
        user_id: "u-carol",
        projects: {
          name: "P",
          hourly_rate: 300, // beats member rate
          customer_id: null,
          customers: null,
        },
      },
    ];
    try {
      await createInvoiceAction(fd({ team_id: "team-1" }));
    } catch {
      // redirect
    }
    const lineInsert = state.inserts.find(
      (i) => i.table === "invoice_line_items",
    );
    const rows = lineInsert?.rows as Array<{ unit_price: number }>;
    expect(rows[0]?.unit_price).toBe(300);
  });
});
