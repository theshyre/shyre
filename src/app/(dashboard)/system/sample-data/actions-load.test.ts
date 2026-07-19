import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSampleData } from "@/lib/sample-data/generate";

/**
 * Deep-orchestration harness for the sample-data loader / wiper —
 * complements actions.test.ts (which covers the gates) by actually
 * driving loadSample / deleteSampleRowsInOrg / deleteSampleUsersForTeam
 * through a queue-per-table Supabase double. Uses the REAL
 * generateSampleData so the fixture can never drift from the
 * generator's shape.
 */

const fakeUserId = "u-sysadmin";
const TEAM = "t-1";

vi.mock("@/lib/safe-action", () => ({
  runSafeAction: async (
    formData: FormData,
    fn: (
      fd: FormData,
      ctx: { supabase: unknown; userId: string },
    ) => Promise<void>,
  ) => {
    await fn(formData, { supabase: userClient(), userId: fakeUserId });
    return { success: true };
  },
}));

vi.mock("@/lib/system-admin", () => ({
  isSystemAdmin: () => Promise.resolve(true),
}));

vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: () =>
    Promise.resolve({ userId: fakeUserId, role: "owner" }),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClient(),
}));

interface Filter {
  op: string;
  col: string;
  value: unknown;
}

interface WriteRec {
  client: "user" | "admin";
  kind: "insert" | "update" | "delete" | "upsert";
  table: string;
  payload?: unknown;
  filters: Filter[];
}

const state: {
  writes: WriteRec[];
  idCounters: Record<string, number>;
  /** Failure injection: table → error for INSERTs on the user client. */
  failInsertTable: string | null;
  /** Queue of admin time_entries SELECT results (invoice windows). */
  windowEntryQueues: Record<string, unknown>[][];
  /** Sample auth users returned by admin.auth.admin.listUsers. */
  authUsers: {
    id: string;
    user_metadata: Record<string, unknown>;
  }[];
  deletedAuthUsers: string[];
  createdAuthUsers: { email: string; user_metadata: unknown }[];
  /** team_members rows served per orphan-scan query, FIFO. */
  membershipQueues: Record<string, unknown>[][];
  /** teams.business_id served for orphan teams (maybeSingle). */
  orphanTeamBusiness: string | null;
  /** Count returned for "other teams referencing this business". */
  businessRefCount: number;
} = {
  writes: [],
  idCounters: {},
  failInsertTable: null,
  windowEntryQueues: [],
  authUsers: [],
  deletedAuthUsers: [],
  createdAuthUsers: [],
  membershipQueues: [],
  orphanTeamBusiness: null,
  businessRefCount: 0,
};

function nextId(table: string): string {
  const n = state.idCounters[table] ?? 0;
  state.idCounters[table] = n + 1;
  return `${table}-${n}`;
}

/** Echo an inserted row back with a generated id, keeping the fields
 *  the loader re-reads (name / category_set_id). */
function echoRows(table: string, rows: unknown): Record<string, unknown>[] {
  const list = Array.isArray(rows) ? rows : [rows];
  return list.map((r) => ({
    id: nextId(table),
    ...(typeof r === "object" && r !== null
      ? {
          name: (r as Record<string, unknown>).name,
          category_set_id: (r as Record<string, unknown>).category_set_id,
        }
      : {}),
  }));
}

function makeInsertChain(
  client: "user" | "admin",
  table: string,
  rows: unknown,
): Record<string, unknown> {
  const rec: WriteRec = { client, kind: "insert", table, payload: rows, filters: [] };
  const error =
    client === "user" && state.failInsertTable === table
      ? { message: `insert into ${table} failed` }
      : null;
  const echoed = error ? null : echoRows(table, rows);
  const result = { data: echoed, error };
  const chain: Record<string, unknown> = {
    select: () => chain,
    single: () => {
      state.writes.push(rec);
      return Promise.resolve({ data: echoed?.[0] ?? null, error });
    },
    then: (
      onF: (v: unknown) => unknown,
      onR?: (e: unknown) => unknown,
    ): Promise<unknown> => {
      state.writes.push(rec);
      return Promise.resolve(result).then(onF, onR);
    },
  };
  return chain;
}

function makeWriteChain(
  client: "user" | "admin",
  kind: "update" | "delete",
  table: string,
  payload?: unknown,
): Record<string, unknown> {
  const rec: WriteRec = { client, kind, table, payload, filters: [] };
  const chain: Record<string, unknown> = {
    eq: (col: string, value: unknown) => {
      rec.filters.push({ op: "eq", col, value });
      return chain;
    },
    in: (col: string, value: unknown) => {
      rec.filters.push({ op: "in", col, value });
      return chain;
    },
    then: (
      onF: (v: unknown) => unknown,
      onR?: (e: unknown) => unknown,
    ): Promise<unknown> => {
      state.writes.push(rec);
      return Promise.resolve({ data: null, error: null }).then(onF, onR);
    },
  };
  return chain;
}

/** SELECT resolution for the user client, keyed on table + columns. */
function resolveUserSelect(table: string, cols: string): unknown {
  if (table === "teams" && cols === "name") {
    return { data: { name: "Acme" }, error: null };
  }
  if (table === "teams" && cols === "business_id") {
    return { data: { business_id: "b-1" }, error: null };
  }
  if (table === "team_settings") {
    return {
      data: { invoice_prefix: "INV", invoice_next_num: 5 },
      error: null,
    };
  }
  return { data: null, error: null };
}

function makeUserSelectChain(table: string, cols: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    eq: () => chain,
    single: () => Promise.resolve(resolveUserSelect(table, cols)),
    maybeSingle: () => Promise.resolve(resolveUserSelect(table, cols)),
  };
  return chain;
}

function userClient(): Record<string, unknown> {
  return {
    from: (table: string) => ({
      select: (cols: string) => makeUserSelectChain(table, cols),
      insert: (rows: unknown) => makeInsertChain("user", table, rows),
      update: (patch: unknown) => makeWriteChain("user", "update", table, patch),
      upsert: (row: unknown) => {
        state.writes.push({
          client: "user",
          kind: "upsert",
          table,
          payload: row,
          filters: [],
        });
        return Promise.resolve({ data: null, error: null });
      },
      delete: () => makeWriteChain("user", "delete", table),
    }),
  };
}

function makeAdminSelectChain(
  table: string,
  opts?: { count?: string; head?: boolean },
): Record<string, unknown> {
  const filters: Filter[] = [];
  const chain: Record<string, unknown> = {
    eq: (col: string, value: unknown) => {
      filters.push({ op: "eq", col, value });
      return chain;
    },
    gte: () => chain,
    lte: () => chain,
    maybeSingle: () => {
      if (table === "teams") {
        return Promise.resolve({
          data: { business_id: state.orphanTeamBusiness },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then: (
      onF: (v: unknown) => unknown,
      onR?: (e: unknown) => unknown,
    ): Promise<unknown> => {
      if (opts?.head) {
        return Promise.resolve({
          data: null,
          error: null,
          count: table === "teams" ? state.businessRefCount : 0,
        }).then(onF, onR);
      }
      if (table === "time_entries") {
        return Promise.resolve({
          data: state.windowEntryQueues.shift() ?? [],
          error: null,
        }).then(onF, onR);
      }
      if (table === "team_members") {
        return Promise.resolve({
          data: state.membershipQueues.shift() ?? [],
          error: null,
        }).then(onF, onR);
      }
      return Promise.resolve({ data: [], error: null }).then(onF, onR);
    },
  };
  return chain;
}

function adminClient(): Record<string, unknown> {
  return {
    from: (table: string) => ({
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) =>
        makeAdminSelectChain(table, opts),
      insert: (rows: unknown) => makeInsertChain("admin", table, rows),
      update: (patch: unknown) =>
        makeWriteChain("admin", "update", table, patch),
      delete: () => makeWriteChain("admin", "delete", table),
    }),
    auth: {
      admin: {
        listUsers: () =>
          Promise.resolve({
            data: { users: state.authUsers },
            error: null,
          }),
        deleteUser: (id: string) => {
          state.deletedAuthUsers.push(id);
          return Promise.resolve({ error: null });
        },
        createUser: (opts: { email: string; user_metadata: unknown }) => {
          state.createdAuthUsers.push({
            email: opts.email,
            user_metadata: opts.user_metadata,
          });
          return Promise.resolve({
            data: { user: { id: nextId("auth-user") } },
            error: null,
          });
        },
      },
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => userClient(),
}));

import { loadSampleDataAction, removeSampleDataAction } from "./actions";

function reset(): void {
  state.writes = [];
  state.idCounters = {};
  state.failInsertTable = null;
  state.windowEntryQueues = [];
  state.authUsers = [];
  state.deletedAuthUsers = [];
  state.createdAuthUsers = [];
  state.membershipQueues = [];
  state.orphanTeamBusiness = null;
  state.businessRefCount = 0;
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const writesFor = (
  kind: WriteRec["kind"],
  table: string,
): WriteRec[] => state.writes.filter((w) => w.kind === kind && w.table === table);

describe("loadSampleDataAction (full orchestration)", () => {
  beforeEach(reset);

  it("seeds settings, identity, users, customers, projects, categories, entries, invoices and expenses", async () => {
    const data = generateSampleData({ now: new Date() });

    // Serve invoice-window entries: the FIRST invoice gets two
    // billable entries for its customer (one project-rate, one
    // customer-default-rate) — the rest get empty windows, covering
    // the "no entries → skip invoice" path.
    const firstInv = data.invoices[0];
    expect(firstInv).toBeDefined();
    const custId = `customers-${firstInv!.customerIndex}`;
    state.windowEntryQueues = [
      [
        {
          id: "te-a",
          duration_min: 90,
          description: "Fix things",
          user_id: fakeUserId,
          project_id: "projects-0",
          projects: {
            name: "Proj A",
            hourly_rate: 150,
            customer_id: custId,
            customers: { default_rate: 120 },
          },
        },
        {
          id: "te-b",
          duration_min: 30,
          description: null,
          user_id: fakeUserId,
          project_id: "projects-0",
          projects: {
            name: "Proj A",
            hourly_rate: null,
            customer_id: custId,
            customers: { default_rate: 120 },
          },
        },
        // An entry for a DIFFERENT customer must be filtered out.
        {
          id: "te-c",
          duration_min: 60,
          description: "Other customer",
          user_id: fakeUserId,
          project_id: "projects-1",
          projects: {
            name: "Proj B",
            hourly_rate: 100,
            customer_id: "customers-9999",
            customers: null,
          },
        },
      ],
    ];

    const result = await loadSampleDataAction(fd({ team_id: TEAM }));
    expect(result).toEqual({ success: true });

    // 1. Team settings upserted with the generator's visibility flags.
    const settingsUpserts = writesFor("upsert", "team_settings");
    expect(settingsUpserts).toHaveLength(1);
    expect(settingsUpserts[0]?.payload).toMatchObject({
      team_id: TEAM,
      rate_visibility: data.teamSettings.rate_visibility,
    });

    // 1b. Business identity split: public row + role-gated private row.
    expect(writesFor("update", "businesses")[0]?.payload).toMatchObject({
      name: data.businessIdentity.display_name,
      legal_name: data.businessIdentity.legal_name,
    });
    expect(
      writesFor("update", "business_identity_private")[0]?.payload,
    ).toMatchObject({ tax_id: data.businessIdentity.tax_id });

    // Registered agents + state registrations seeded for the business.
    expect(
      (writesFor("insert", "business_registered_agents")[0]?.payload as unknown[])
        .length,
    ).toBe(data.registeredAgents.length);
    expect(
      (
        writesFor("insert", "business_state_registrations")[0]
          ?.payload as unknown[]
      ).length,
    ).toBe(data.stateRegistrations.length);

    // 2. One auth user per generated team member, tagged for cleanup.
    expect(state.createdAuthUsers).toHaveLength(data.teamMembers.length);
    expect(state.createdAuthUsers[0]?.user_metadata).toMatchObject({
      is_sample_user: true,
      sample_team_id: TEAM,
    });
    expect(state.createdAuthUsers[0]?.email).toContain("@shyre-sample.local");
    // Memberships inserted through the admin client (RLS bypass).
    expect(writesFor("insert", "team_members")).toHaveLength(
      data.teamMembers.length,
    );

    // 2b. business_people seeded; the owner row links to the caller.
    const peopleRows = writesFor("insert", "business_people")[0]
      ?.payload as Record<string, unknown>[];
    expect(peopleRows).toHaveLength(data.people.length);
    const ownerRow = peopleRows.find((p) => p.employment_type === "owner");
    expect(ownerRow?.user_id).toBe(fakeUserId);

    // 3-7. Customers, projects, category sets + categories, flagged is_sample.
    const customerRows = writesFor("insert", "customers")[0]
      ?.payload as Record<string, unknown>[];
    expect(customerRows).toHaveLength(data.customers.length);
    expect(customerRows.every((c) => c.is_sample === true)).toBe(true);
    const projectRows = writesFor("insert", "projects")[0]
      ?.payload as Record<string, unknown>[];
    expect(projectRows).toHaveLength(data.projects.length);

    // 8. Every generated entry lands (chunked) through the admin client.
    const entryRows = writesFor("insert", "time_entries").flatMap(
      (w) => w.payload as unknown[],
    );
    expect(entryRows).toHaveLength(data.entries.length);

    // 9. Exactly one invoice materialized (the one with a non-empty
    // window); its line items carry project rate + customer fallback.
    const invoiceInserts = writesFor("insert", "invoices");
    expect(invoiceInserts).toHaveLength(1);
    const inv = invoiceInserts[0]?.payload as Record<string, unknown>;
    expect(inv).toMatchObject({
      team_id: TEAM,
      customer_id: custId,
      is_sample: true,
      status: firstInv!.status,
      tax_rate: 0,
    });
    expect(String(inv.invoice_number)).toMatch(/^INV-/);
    // 1.5h @ 150 + 0.5h @ 120 (customer default fallback) = 285.
    expect(inv.subtotal).toBe(285);
    expect(inv.total).toBe(285);

    const lineItems = writesFor("insert", "invoice_line_items").flatMap(
      (w) => w.payload as Record<string, unknown>[],
    );
    expect(lineItems).toHaveLength(2);
    expect(lineItems.map((li) => li.time_entry_id).sort()).toEqual([
      "te-a",
      "te-b",
    ]);
    // Description prefixes the project name; falls back to bare name.
    expect(lineItems[0]?.description).toBe("Proj A: Fix things");
    expect(lineItems[1]?.description).toBe("Proj A");

    // The billed entries are flipped to invoiced through the admin client.
    const invoicedUpdates = state.writes.filter(
      (w) =>
        w.kind === "update" &&
        w.table === "time_entries" &&
        (w.payload as Record<string, unknown>)?.invoiced === true,
    );
    expect(invoicedUpdates).toHaveLength(1);
    expect(invoicedUpdates[0]?.filters[0]).toMatchObject({
      op: "in",
      col: "id",
    });

    // Invoice counter advanced past the consumed number.
    const counterUpdate = writesFor("update", "team_settings").find(
      (w) => (w.payload as Record<string, unknown>)?.invoice_next_num,
    );
    expect(counterUpdate?.payload).toEqual({ invoice_next_num: 6 });

    // 10. Expenses chunk-inserted with the sample flag.
    const expenseRows = writesFor("insert", "expenses").flatMap(
      (w) => w.payload as Record<string, unknown>[],
    );
    expect(expenseRows).toHaveLength(data.expenses.length);
    expect(expenseRows.every((e) => e.is_sample === true)).toBe(true);

    // Surfaces the load everywhere the sample data shows up.
    for (const path of [
      "/system/sample-data",
      "/time-entries",
      "/customers",
      "/projects",
      "/business",
      `/teams/${TEAM}`,
      "/invoices",
    ]) {
      expect(mockRevalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("wipes existing sample rows before seeding (idempotent reload)", async () => {
    await loadSampleDataAction(fd({ team_id: TEAM }));
    // The pre-wipe issues is_sample-scoped deletes BEFORE the fresh inserts.
    const firstCustomerDelete = state.writes.findIndex(
      (w) => w.kind === "delete" && w.table === "customers",
    );
    const firstCustomerInsert = state.writes.findIndex(
      (w) => w.kind === "insert" && w.table === "customers",
    );
    expect(firstCustomerDelete).toBeGreaterThanOrEqual(0);
    expect(firstCustomerInsert).toBeGreaterThan(firstCustomerDelete);
    const del = state.writes[firstCustomerDelete];
    expect(del?.filters).toContainEqual({
      op: "eq",
      col: "is_sample",
      value: true,
    });
  });

  it("propagates a failed customer insert instead of continuing half-seeded", async () => {
    state.failInsertTable = "customers";
    await expect(loadSampleDataAction(fd({ team_id: TEAM }))).rejects.toThrow();
    // Nothing downstream of customers was inserted.
    expect(writesFor("insert", "projects")).toHaveLength(0);
    expect(writesFor("insert", "invoices")).toHaveLength(0);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("removeSampleDataAction (full wipe + auth-user cleanup)", () => {
  beforeEach(reset);

  it("deletes sample-flagged rows, business children, sample users and their orphan personal teams", async () => {
    state.authUsers = [
      {
        id: "su-1",
        user_metadata: { is_sample_user: true, sample_team_id: TEAM },
      },
      // A sample user belonging to ANOTHER team must be left alone.
      {
        id: "su-other",
        user_metadata: { is_sample_user: true, sample_team_id: "t-other" },
      },
      // A real human must never be touched.
      { id: "human-1", user_metadata: {} },
    ];
    // su-1 owns a personal team pt-1 (auto-created at signup).
    state.membershipQueues = [
      [
        {
          team_id: "pt-1",
          role: "owner",
          teams: { id: "pt-1", is_personal: true },
        },
      ],
    ];
    state.orphanTeamBusiness = "pb-1";
    state.businessRefCount = 0;

    const result = await removeSampleDataAction(fd({ team_id: TEAM }));
    expect(result).toEqual({ success: true });

    // Business child tables wiped by business_id.
    for (const table of [
      "business_people",
      "business_state_registrations",
      "business_tax_registrations",
      "business_registered_agents",
    ]) {
      const del = writesFor("delete", table)[0];
      expect(del, table).toBeDefined();
      expect(del?.filters).toContainEqual({
        op: "eq",
        col: "business_id",
        value: "b-1",
      });
    }

    // Team-scoped rows wiped ONLY where is_sample = true.
    for (const table of [
      "invoices",
      "expenses",
      "time_entries",
      "category_sets",
      "projects",
      "customers",
    ]) {
      const del = state.writes.find(
        (w) => w.kind === "delete" && w.table === table && w.client === "user",
      );
      expect(del, table).toBeDefined();
      expect(del?.filters).toContainEqual({
        op: "eq",
        col: "team_id",
        value: TEAM,
      });
      expect(del?.filters).toContainEqual({
        op: "eq",
        col: "is_sample",
        value: true,
      });
    }

    // Only THIS team's sample user is deleted.
    expect(state.deletedAuthUsers).toEqual(["su-1"]);

    // The orphaned personal team and its now-unreferenced business drop.
    const teamDeletes = state.writes.filter(
      (w) => w.client === "admin" && w.kind === "delete" && w.table === "teams",
    );
    expect(teamDeletes[0]?.filters).toContainEqual({
      op: "eq",
      col: "id",
      value: "pt-1",
    });
    const bizDeletes = state.writes.filter(
      (w) =>
        w.client === "admin" && w.kind === "delete" && w.table === "businesses",
    );
    expect(bizDeletes[0]?.filters).toContainEqual({
      op: "eq",
      col: "id",
      value: "pb-1",
    });
  });

  it("keeps the business when other teams still reference it", async () => {
    state.authUsers = [
      {
        id: "su-1",
        user_metadata: { is_sample_user: true, sample_team_id: TEAM },
      },
    ];
    state.membershipQueues = [
      [
        {
          team_id: "pt-1",
          role: "owner",
          teams: { id: "pt-1", is_personal: true },
        },
      ],
    ];
    state.orphanTeamBusiness = "pb-1";
    state.businessRefCount = 2;

    await removeSampleDataAction(fd({ team_id: TEAM }));

    expect(
      state.writes.filter(
        (w) =>
          w.client === "admin" &&
          w.kind === "delete" &&
          w.table === "businesses",
      ),
    ).toHaveLength(0);
  });

  it("does not collect the target team itself or non-personal teams as orphans", async () => {
    state.authUsers = [
      {
        id: "su-1",
        user_metadata: { is_sample_user: true, sample_team_id: TEAM },
      },
    ];
    state.membershipQueues = [
      [
        // The sample user is a member (not owner) of a real team.
        {
          team_id: "real-1",
          role: "member",
          teams: { id: "real-1", is_personal: false },
        },
        // And owner of the sample team itself — excluded by id.
        { team_id: TEAM, role: "owner", teams: { id: TEAM, is_personal: true } },
      ],
    ];

    await removeSampleDataAction(fd({ team_id: TEAM }));

    expect(state.deletedAuthUsers).toEqual(["su-1"]);
    expect(
      state.writes.filter(
        (w) => w.client === "admin" && w.kind === "delete" && w.table === "teams",
      ),
    ).toHaveLength(0);
  });
});
