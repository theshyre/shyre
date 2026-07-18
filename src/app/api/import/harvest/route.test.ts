import { describe, it, expect, vi, beforeEach } from "vitest";
import { HarvestApiError } from "@/lib/harvest";
import type {
  HarvestClient,
  HarvestProject,
  HarvestTimeEntry,
  HarvestUser,
  HarvestInvoice,
  HarvestInvoicePayment,
  HarvestInvoiceMessage,
} from "@/lib/harvest";

// ────────────────────────────────────────────────────────────────
// Queue-per-(table, operation) thenable builder. The harvest route
// hits the same table with different operations (select existing,
// insert new, update refresh) — keying the queue on the operation
// keeps fixtures readable and avoids depending on chain-call order
// inside a single operation.
//
// Mutating operations are also recorded into `calls` so tests can
// assert WHAT landed (rows, user attribution) — behavior, not the
// mock chain.
// ────────────────────────────────────────────────────────────────
interface Result {
  data: unknown;
  error: unknown;
  count?: number | null;
}
let queues: Record<string, Result[]> = {};
let calls: Array<{ key: string; payload: unknown }> = [];

interface Builder extends PromiseLike<Result> {
  select: (cols?: string) => Builder;
  eq: (col: string, val: unknown) => Builder;
  in: (col: string, vals: unknown[]) => Builder;
  is: (col: string, val: unknown) => Builder;
  order: (col: string, opts?: unknown) => Builder;
  insert: (rows: unknown) => Builder;
  update: (values: unknown) => Builder;
  delete: () => Builder;
  upsert: (rows: unknown, opts?: unknown) => Builder;
  single: () => Promise<Result>;
  maybeSingle: () => Promise<Result>;
}

function makeBuilder(scope: string, table: string): Builder {
  let op = "select";
  const resolve = (): Result =>
    queues[`${scope}${table}.${op}`]?.shift() ?? { data: null, error: null };
  const record = (nextOp: string, payload: unknown): Builder => {
    op = nextOp;
    calls.push({ key: `${scope}${table}.${nextOp}`, payload });
    return builder;
  };
  const builder: Builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    order: () => builder,
    insert: (rows) => record("insert", rows),
    update: (values) => record("update", values),
    delete: () => record("delete", null),
    upsert: (rows) => record("upsert", rows),
    single: () => Promise.resolve(resolve()),
    maybeSingle: () => Promise.resolve(resolve()),
    then: (onF, onR) => Promise.resolve(resolve()).then(onF, onR),
  };
  return builder;
}

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => makeBuilder("", table),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeBuilder("admin.", table),
  }),
}));

const validateTeamAccessMock = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (teamId: string) => validateTeamAccessMock(teamId),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const materializeMock = vi.fn();
vi.mock("@/lib/import-shell-author", () => ({
  materializeHarvestShellAccount: (admin: unknown, args: unknown) =>
    materializeMock(admin, args),
}));

// Keep HarvestApiError (and every other pure export) real — the route
// classifies caught errors via `instanceof HarvestApiError`, and the
// pure row builders in harvest-import-logic consume the same shapes.
const validateCredsMock = vi.fn();
const fetchClientsMock = vi.fn();
const fetchProjectsMock = vi.fn();
const fetchEntriesMock = vi.fn();
const fetchUsersMock = vi.fn();
const fetchInvoicesMock = vi.fn();
const fetchPaymentsMock = vi.fn();
const fetchMessagesMock = vi.fn();
vi.mock("@/lib/harvest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harvest")>();
  return {
    ...actual,
    validateHarvestCredentials: (opts: unknown) => validateCredsMock(opts),
    fetchHarvestClients: (opts: unknown) => fetchClientsMock(opts),
    fetchHarvestProjects: (opts: unknown) => fetchProjectsMock(opts),
    fetchHarvestTimeEntries: (opts: unknown, range: unknown) =>
      fetchEntriesMock(opts, range),
    fetchHarvestUsers: (opts: unknown) => fetchUsersMock(opts),
    fetchHarvestInvoices: (opts: unknown, range: unknown) =>
      fetchInvoicesMock(opts, range),
    fetchHarvestInvoicePayments: (id: number, opts: unknown) =>
      fetchPaymentsMock(id, opts),
    fetchHarvestInvoiceMessages: (id: number, opts: unknown) =>
      fetchMessagesMock(id, opts),
  };
});

import { POST } from "./route";

// ────────────────────────────────────────────────────────────────
// Harvest fixtures — full API shapes so the REAL row builders in
// harvest-import-logic run against them (only the HTTP fetch layer
// is mocked).
// ────────────────────────────────────────────────────────────────
const T = "2026-01-01T00:00:00Z";

const harvestClient: HarvestClient = {
  id: 11,
  name: "Acme",
  currency: "USD",
  address: null,
  is_active: true,
  created_at: T,
  updated_at: T,
};

const harvestProject: HarvestProject = {
  id: 22,
  name: "Website",
  code: null,
  is_active: true,
  is_billable: true,
  budget: null,
  budget_by: "none",
  hourly_rate: 150,
  notes: null,
  client: { id: 11, name: "Acme" },
  created_at: T,
  updated_at: T,
};

const harvestEntry: HarvestTimeEntry = {
  id: 33,
  spent_date: "2026-01-05",
  hours: 2,
  notes: "Build the thing",
  is_locked: false,
  is_running: false,
  billable: true,
  billable_rate: 150,
  started_time: "09:00",
  ended_time: "11:00",
  project: { id: 22, name: "Website" },
  client: { id: 11, name: "Acme" },
  task: { id: 5, name: "Dev" },
  user: { id: 77, name: "Mariah Malcom" },
  invoice: null,
  external_reference: null,
  created_at: T,
  updated_at: T,
};

const harvestUser: HarvestUser = {
  id: 77,
  first_name: "Mariah",
  last_name: "Malcom",
  email: "mariah@example.test",
  is_active: true,
};

const harvestInvoice: HarvestInvoice = {
  id: 44,
  number: "H-100",
  client: { id: 11, name: "Acme" },
  amount: 1085,
  due_amount: 0,
  currency: "USD",
  state: "paid",
  issue_date: "2026-01-10",
  due_date: null,
  sent_at: "2026-01-10T09:00:00Z",
  paid_at: "2026-01-20T10:00:00Z",
  paid_date: "2026-01-20",
  notes: null,
  subject: "January work",
  tax: 8.5,
  tax_amount: 85,
  tax2: null,
  tax2_amount: 0,
  discount: null,
  discount_amount: 0,
  line_items: [
    {
      id: 1,
      kind: "Service",
      description: "Dev work",
      quantity: 10,
      unit_price: 100,
      amount: 1000,
      taxed: true,
      taxed2: false,
      project: { id: 22, name: "Website" },
    },
  ],
  created_at: T,
  updated_at: T,
};

const realPayment: HarvestInvoicePayment = {
  id: 1,
  amount: 500,
  paid_at: "2026-01-20T10:00:00Z",
  paid_date: "2026-01-20",
  recorded_by: "Marcus",
  recorded_by_email: null,
  notes: null,
  transaction_id: null,
  payment_gateway: null,
  created_at: T,
  updated_at: T,
};

const zeroPayment: HarvestInvoicePayment = {
  ...realPayment,
  id: 2,
  amount: 0,
};

const sendMessage: HarvestInvoiceMessage = {
  id: 9,
  sent_by: "Marcus",
  sent_by_email: null,
  sent_from: null,
  sent_from_email: null,
  recipients: [{ name: "Pat AP", email: "ap@acme.test" }],
  subject: "Invoice H-100",
  body: null,
  include_link_to_client_invoice: false,
  attach_pdf: true,
  send_me_a_copy: false,
  thank_you: false,
  event_type: null,
  reminder: false,
  send_reminder_on: null,
  created_at: T,
  updated_at: T,
};

function importRequest(body: Record<string, unknown>): Request {
  return new Request("https://shyre.test/api/import/harvest", {
    method: "POST",
    body: JSON.stringify({
      token: "tok",
      accountId: "acct-1",
      organizationId: "team-1",
      ...body,
    }),
  });
}

/** Every fetcher returns an empty account unless a test overrides. */
function emptyHarvestAccount(): void {
  fetchClientsMock.mockResolvedValue([]);
  fetchProjectsMock.mockResolvedValue([]);
  fetchEntriesMock.mockResolvedValue([]);
  fetchUsersMock.mockResolvedValue([]);
  fetchInvoicesMock.mockResolvedValue([]);
  fetchPaymentsMock.mockResolvedValue([]);
  fetchMessagesMock.mockResolvedValue([]);
}

function loggedActions(): string[] {
  return logErrorMock.mock.calls.map(
    (c) => (c[1] as { action?: string }).action ?? "",
  );
}

beforeEach(() => {
  queues = {};
  calls = [];
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  validateTeamAccessMock.mockResolvedValue({ userId: "u1", role: "owner" });
  emptyHarvestAccount();
});

describe("POST /api/import/harvest — gates", () => {
  it("returns 401 without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(importRequest({ action: "validate" }));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 when token/accountId/organizationId are missing", async () => {
    const res = await POST(importRequest({ action: "validate", token: "" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Missing required fields");
  });

  it("returns 403 when the caller has no access to the team", async () => {
    validateTeamAccessMock.mockRejectedValue(
      new Error("You do not have access to this team."),
    );
    const res = await POST(importRequest({ action: "import" }));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("No access to this team");
  });

  it("returns 403 for a plain member — imports are owner/admin-grade (SAL-009)", async () => {
    validateTeamAccessMock.mockResolvedValue({ userId: "u1", role: "member" });
    const res = await POST(importRequest({ action: "import" }));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("owners or admins");
  });

  it("returns 400 for an unknown action", async () => {
    const res = await POST(importRequest({ action: "explode" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Invalid action");
  });
});

describe("POST /api/import/harvest — action=validate", () => {
  it("passes the credential-check result through verbatim", async () => {
    validateCredsMock.mockResolvedValue({
      valid: true,
      companyName: "Acme Co",
      timeZone: "America/New_York",
    });
    const res = await POST(importRequest({ action: "validate" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: true,
      companyName: "Acme Co",
      timeZone: "America/New_York",
    });
    expect(validateCredsMock).toHaveBeenCalledWith({
      token: "tok",
      accountId: "acct-1",
    });
  });
});

describe("POST /api/import/harvest — action=preview", () => {
  it("returns counts, existing-match counts, and the user-mapping scaffold", async () => {
    validateCredsMock.mockResolvedValue({
      valid: true,
      companyName: "Acme Co",
      timeZone: "America/New_York",
    });
    fetchClientsMock.mockResolvedValue([harvestClient]);
    fetchProjectsMock.mockResolvedValue([harvestProject]);
    fetchEntriesMock.mockResolvedValue([harvestEntry]);
    fetchUsersMock.mockResolvedValue([harvestUser]);
    fetchInvoicesMock.mockResolvedValue([harvestInvoice]);

    // Mapping scaffold lookups.
    queues["team_members.select"] = [
      { data: [{ user_id: "u1" }], error: null },
    ];
    queues["user_profiles.select"] = [
      { data: [{ user_id: "u1", display_name: "Marcus" }], error: null },
      { data: { display_name: "Marcus" }, error: null }, // caller name
    ];
    queues["teams.select"] = [{ data: { business_id: "biz-1" }, error: null }];
    queues["business_people.select"] = [
      {
        data: [
          {
            id: "bp-1",
            legal_name: "Mariah Malcom",
            preferred_name: null,
            work_email: null,
            employment_type: "contractor_1099",
          },
        ],
        error: null,
      },
    ];
    // Existing-match count queries: 1 customer already imported.
    queues["customers.select"] = [
      { data: [{ import_source_id: "11" }], error: null },
    ];
    queues["projects.select"] = [{ data: [], error: null }];
    queues["time_entries.select"] = [{ data: [], error: null }];
    queues["invoices.select"] = [{ data: [], error: null }];

    const res = await POST(importRequest({ action: "preview" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      companyName: "Acme Co",
      timeZone: "America/New_York",
      customers: 1,
      projects: 1,
      timeEntries: 1,
      invoices: 1,
      invoiceLineItems: 1,
      categoryCount: 1,
      customerNames: ["Acme"],
      projectNames: ["Website"],
      existingMatches: {
        customers: 1,
        projects: 0,
        timeEntries: 0,
        invoices: 0,
      },
      callerDisplayName: "Marcus",
      callerUserId: "u1",
    });
    const users = json.harvestUsers as Array<Record<string, unknown>>;
    expect(users).toEqual([
      {
        id: 77,
        name: "Mariah Malcom",
        email: "mariah@example.test",
        entryCount: 1,
      },
    ]);
    // Unlinked business person matched by name → offered as bp:<id>.
    expect(json.defaultMapping).toMatchObject({ "77": "bp:bp-1" });
  });

  it("returns 400 when the credentials are invalid", async () => {
    validateCredsMock.mockResolvedValue({
      valid: false,
      error: "Invalid token",
    });
    const res = await POST(importRequest({ action: "preview" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Invalid token");
  });

  it("maps a HarvestApiError to 502 with the classified kind, and logs it", async () => {
    validateCredsMock.mockResolvedValue({ valid: true });
    fetchClientsMock.mockRejectedValue(
      new HarvestApiError({
        status: 429,
        endpoint: "/clients",
        rawBody: "slow down",
      }),
    );
    const res = await POST(importRequest({ action: "preview" }));
    expect(res.status).toBe(502);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.errorCode).toBe("rate_limited");
    expect(json.status).toBe(429);
    expect(json.endpoint).toBe("/clients");
    expect(json.detail).toBe("slow down");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![1]).toMatchObject({
      userId: "u1",
      teamId: "team-1",
      url: "/api/import/harvest",
      action: "harvestImportPreview",
    });
  });
});

describe("POST /api/import/harvest — action=import", () => {
  it("full run: lands customer, project, categories, invoice + payments, time entry; filters zero-amount payments", async () => {
    fetchClientsMock.mockResolvedValue([harvestClient]);
    fetchProjectsMock.mockResolvedValue([harvestProject]);
    fetchEntriesMock.mockResolvedValue([harvestEntry]);
    fetchInvoicesMock.mockResolvedValue([harvestInvoice]);
    fetchPaymentsMock.mockResolvedValue([realPayment, zeroPayment]);
    fetchMessagesMock.mockResolvedValue([sendMessage]);

    queues["import_runs.insert"] = [{ data: null, error: null }];
    // Customers: no existing by source id, none by name → insert.
    queues["customers.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["customers.insert"] = [{ data: { id: "cust-1" }, error: null }];
    // Category set: none yet → create, then one category for "Dev".
    queues["category_sets.select"] = [{ data: null, error: null }];
    queues["category_sets.insert"] = [{ data: { id: "set-1" }, error: null }];
    queues["categories.select"] = [{ data: [], error: null }];
    queues["categories.insert"] = [
      { data: [{ id: "cat-1", name: "Dev" }], error: null },
    ];
    // Projects: none existing → insert; later the ticket-defaults bulk load.
    queues["projects.select"] = [
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: "proj-1",
            github_repo: null,
            jira_project_key: null,
            is_internal: false,
          },
        ],
        error: null,
      },
    ];
    queues["projects.insert"] = [{ data: { id: "proj-1" }, error: null }];
    // Invoices: none existing → insert + line items + payments.
    queues["invoices.select"] = [{ data: [], error: null }];
    queues["invoices.insert"] = [{ data: { id: "inv-1" }, error: null }];
    queues["invoices.update"] = [{ data: null, error: null }]; // sent_to
    queues["invoice_line_items.insert"] = [{ data: null, error: null }];
    queues["invoice_payments.delete"] = [{ data: null, error: null }];
    queues["invoice_payments.insert"] = [{ data: null, error: null }];
    // Time entries land through the admin client.
    queues["admin.time_entries.upsert"] = [
      { data: null, error: null, count: 1 },
    ];
    // Reconciliation re-query.
    queues["time_entries.select"] = [
      {
        data: [{ import_source_id: "33", duration_min: 120 }],
        error: null,
      },
    ];
    queues["import_runs.update"] = [{ data: null, error: null }];

    const res = await POST(
      importRequest({
        action: "import",
        timeZone: "UTC",
        userMapping: { "77": "importer" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.success).toBe(true);
    expect(typeof json.importRunId).toBe("string");
    expect(json.imported).toEqual({
      customers: 1,
      projects: 1,
      invoices: 1,
      invoicesRefreshed: 0,
      invoiceLineItems: 1,
      invoicePayments: 1,
      timeEntries: 1,
    });
    expect(json.skipped).toEqual({
      timeEntries: 0,
      reasons: { "non-positive payment amount": 1 },
    });
    expect(json.errors).toEqual([]);
    expect(json.entryDateRange).toEqual({
      earliest: "2026-01-05",
      latest: "2026-01-05",
    });

    // The time entry landed via the ADMIN client (RLS bypass is the
    // documented design for multi-author imports), attributed to the
    // importer, on the right project, with the Harvest task's category.
    const upsert = calls.find((c) => c.key === "admin.time_entries.upsert");
    expect(upsert).toBeDefined();
    const rows = upsert!.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      team_id: "team-1",
      user_id: "u1",
      project_id: "proj-1",
      category_id: "cat-1",
      billable: true,
      imported_from: "harvest",
      import_source_id: "33",
      start_time: "2026-01-05T09:00:00.000Z",
      end_time: "2026-01-05T11:00:00.000Z",
    });

    // Only the real (amount > 0) payment was inserted.
    const payInsert = calls.find((c) => c.key === "invoice_payments.insert");
    const payRows = payInsert!.payload as Array<Record<string, unknown>>;
    expect(payRows).toHaveLength(1);
    expect(payRows[0]).toMatchObject({
      invoice_id: "inv-1",
      amount: 500,
      currency: "USD",
    });

    // Latest send recipient backfilled onto the invoice.
    const sentTo = calls.find(
      (c) =>
        c.key === "invoices.update" &&
        (c.payload as Record<string, unknown>).sent_to_email !== undefined,
    );
    expect(sentTo!.payload).toEqual({
      sent_to_email: "ap@acme.test",
      sent_to_name: "Pat AP",
    });

    // Run closed out as completed with the summary attached.
    const closeOut = calls.find(
      (c) =>
        c.key === "import_runs.update" &&
        (c.payload as Record<string, unknown>).status === "completed",
    );
    expect(closeOut).toBeDefined();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("returns 500 and logs when the import_runs record can't be created", async () => {
    queues["import_runs.insert"] = [
      { data: null, error: { message: "rls denied" } },
    ];
    const res = await POST(
      importRequest({ action: "import", userMapping: {} }),
    );
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Could not record import run");
    expect(json.error).toContain("rls denied");
    expect(loggedActions()).toEqual(["harvestImportRunInsert"]);
  });

  it("collects a per-row customer failure in errors[] AND error_logs, and still completes the run", async () => {
    fetchClientsMock.mockResolvedValue([harvestClient]);

    queues["import_runs.insert"] = [{ data: null, error: null }];
    queues["customers.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["customers.insert"] = [
      { data: null, error: { message: "duplicate key" } },
    ];
    queues["projects.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["invoices.select"] = [{ data: [], error: null }];
    queues["import_runs.update"] = [{ data: null, error: null }];

    const res = await POST(
      importRequest({ action: "import", userMapping: {} }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      errors: string[];
      imported: { customers: number };
    };
    expect(json.success).toBe(true);
    expect(json.errors).toEqual(['Customer "Acme": duplicate key']);
    expect(json.imported.customers).toBe(0);
    expect(loggedActions()).toEqual(["harvestImportRowError"]);
  });

  it("dedupes by import_source_id — an already-imported customer/project is reused, not re-inserted", async () => {
    fetchClientsMock.mockResolvedValue([harvestClient]);
    fetchProjectsMock.mockResolvedValue([harvestProject]);

    queues["import_runs.insert"] = [{ data: null, error: null }];
    queues["customers.select"] = [
      { data: [{ id: "cust-old", name: "Acme", import_source_id: "11" }], error: null },
      { data: [], error: null },
    ];
    queues["projects.select"] = [
      {
        data: [
          {
            id: "proj-old",
            name: "Website",
            import_source_id: "22",
            category_set_id: "set-existing",
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    queues["invoices.select"] = [{ data: [], error: null }];
    queues["import_runs.update"] = [{ data: null, error: null }];

    const res = await POST(
      importRequest({ action: "import", userMapping: {} }),
    );
    const json = (await res.json()) as {
      imported: { customers: number; projects: number };
      errors: string[];
    };
    expect(json.imported).toMatchObject({ customers: 0, projects: 0 });
    expect(json.errors).toEqual([]);
    // No inserts attempted against either table.
    expect(calls.some((c) => c.key === "customers.insert")).toBe(false);
    expect(calls.some((c) => c.key === "projects.insert")).toBe(false);
  });

  it("re-import refreshes an existing invoice in place (update + line-item replace), not a duplicate insert", async () => {
    fetchInvoicesMock.mockResolvedValue([harvestInvoice]);
    fetchPaymentsMock.mockResolvedValue([realPayment]);
    fetchMessagesMock.mockResolvedValue([]);

    queues["import_runs.insert"] = [{ data: null, error: null }];
    queues["customers.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["projects.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["invoices.select"] = [
      { data: [{ id: "inv-old", import_source_id: "44" }], error: null },
    ];
    queues["invoices.update"] = [{ data: null, error: null }];
    queues["invoice_line_items.delete"] = [{ data: null, error: null }];
    queues["invoice_line_items.insert"] = [{ data: null, error: null }];
    queues["invoice_payments.delete"] = [{ data: null, error: null }];
    queues["invoice_payments.insert"] = [{ data: null, error: null }];
    queues["import_runs.update"] = [{ data: null, error: null }];

    const res = await POST(
      importRequest({ action: "import", userMapping: {} }),
    );
    const json = (await res.json()) as {
      imported: {
        invoices: number;
        invoicesRefreshed: number;
        invoiceLineItems: number;
      };
      errors: string[];
    };
    expect(json.errors).toEqual([]);
    expect(json.imported.invoices).toBe(0);
    expect(json.imported.invoicesRefreshed).toBe(1);
    expect(json.imported.invoiceLineItems).toBe(1);
    expect(calls.some((c) => c.key === "invoices.insert")).toBe(false);
    // Old line items were replaced, not appended.
    expect(calls.some((c) => c.key === "invoice_line_items.delete")).toBe(
      true,
    );
    // The refresh only touches importer-owned fields — creation
    // attribution (team_id / user_id / created_at) stays untouched.
    const refresh = calls.find((c) => c.key === "invoices.update");
    const updated = refresh!.payload as Record<string, unknown>;
    expect(updated.status).toBe("paid");
    expect(updated.team_id).toBeUndefined();
    expect(updated.user_id).toBeUndefined();
  });

  it("materializes shell accounts for bp:<id> mappings and attributes the entries to the shell user", async () => {
    fetchClientsMock.mockResolvedValue([harvestClient]);
    fetchProjectsMock.mockResolvedValue([harvestProject]);
    fetchEntriesMock.mockResolvedValue([harvestEntry]);
    materializeMock.mockResolvedValue("shell-user-1");

    queues["import_runs.insert"] = [{ data: null, error: null }];
    queues["customers.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["customers.insert"] = [{ data: { id: "cust-1" }, error: null }];
    queues["category_sets.select"] = [{ data: { id: "set-1" }, error: null }];
    queues["categories.select"] = [
      { data: [{ id: "cat-1", name: "Dev" }], error: null },
    ];
    queues["projects.select"] = [
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: "proj-1",
            github_repo: null,
            jira_project_key: null,
            is_internal: false,
          },
        ],
        error: null,
      },
    ];
    queues["projects.insert"] = [{ data: { id: "proj-1" }, error: null }];
    queues["invoices.select"] = [{ data: [], error: null }];
    queues["admin.business_people.update"] = [{ data: null, error: null }];
    queues["admin.time_entries.upsert"] = [
      { data: null, error: null, count: 1 },
    ];
    queues["time_entries.select"] = [{ data: [], error: null }];
    queues["import_runs.update"] = [{ data: null, error: null }];

    const res = await POST(
      importRequest({
        action: "import",
        timeZone: "UTC",
        userMapping: { "77": "bp:bp-9" },
      }),
    );
    expect(res.status).toBe(200);

    expect(materializeMock).toHaveBeenCalledTimes(1);
    expect(materializeMock.mock.calls[0]![1]).toEqual({
      teamId: "team-1",
      harvestUserId: 77,
      displayName: "Mariah Malcom",
    });
    // The existing People-page record got claimed by the shell user.
    const link = calls.find((c) => c.key === "admin.business_people.update");
    expect(link!.payload).toEqual({ user_id: "shell-user-1" });
    // And the time entry is attributed to the shell user, not the importer.
    const upsert = calls.find((c) => c.key === "admin.time_entries.upsert");
    const rows = upsert!.payload as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ user_id: "shell-user-1" });
  });

  it("falls back to skip (never silent misattribution) when shell-account creation fails", async () => {
    fetchClientsMock.mockResolvedValue([harvestClient]);
    fetchProjectsMock.mockResolvedValue([harvestProject]);
    fetchEntriesMock.mockResolvedValue([harvestEntry]);
    materializeMock.mockRejectedValue(new Error("auth admin down"));

    queues["import_runs.insert"] = [{ data: null, error: null }];
    queues["customers.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["customers.insert"] = [{ data: { id: "cust-1" }, error: null }];
    queues["category_sets.select"] = [{ data: { id: "set-1" }, error: null }];
    queues["categories.select"] = [
      { data: [{ id: "cat-1", name: "Dev" }], error: null },
    ];
    queues["projects.select"] = [
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: "proj-1",
            github_repo: null,
            jira_project_key: null,
            is_internal: false,
          },
        ],
        error: null,
      },
    ];
    queues["projects.insert"] = [{ data: { id: "proj-1" }, error: null }];
    queues["invoices.select"] = [{ data: [], error: null }];
    queues["time_entries.select"] = [{ data: [], error: null }];
    queues["import_runs.update"] = [{ data: null, error: null }];

    const res = await POST(
      importRequest({
        action: "import",
        timeZone: "UTC",
        userMapping: { "77": "shell" },
      }),
    );
    const json = (await res.json()) as {
      errors: string[];
      imported: { timeEntries: number };
      skipped: { timeEntries: number; reasons: Record<string, number> };
    };
    expect(json.errors).toEqual([
      "Shell account create failed for Mariah Malcom: auth admin down",
    ]);
    expect(json.imported.timeEntries).toBe(0);
    expect(json.skipped.timeEntries).toBe(1);
    expect(json.skipped.reasons).toEqual({ "user mapped to skip": 1 });
    // No upsert should have been attempted with a sentinel user id.
    expect(calls.some((c) => c.key === "admin.time_entries.upsert")).toBe(
      false,
    );
  });

  it("invoice-locked batch falls back to per-row upserts and routes locked rows to skipReasons", async () => {
    fetchClientsMock.mockResolvedValue([harvestClient]);
    fetchProjectsMock.mockResolvedValue([harvestProject]);
    fetchEntriesMock.mockResolvedValue([harvestEntry]);

    queues["import_runs.insert"] = [{ data: null, error: null }];
    queues["customers.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["customers.insert"] = [{ data: { id: "cust-1" }, error: null }];
    queues["category_sets.select"] = [{ data: { id: "set-1" }, error: null }];
    queues["categories.select"] = [
      { data: [{ id: "cat-1", name: "Dev" }], error: null },
    ];
    queues["projects.select"] = [
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: "proj-1",
            github_repo: null,
            jira_project_key: null,
            is_internal: false,
          },
        ],
        error: null,
      },
    ];
    queues["projects.insert"] = [{ data: { id: "proj-1" }, error: null }];
    queues["invoices.select"] = [{ data: [], error: null }];
    // Batch upsert trips the invoiced-entry protection trigger, then
    // the per-row retry trips it again for the same row.
    queues["admin.time_entries.upsert"] = [
      { data: null, error: { message: "P0001: Time entry is invoiced" } },
      { data: null, error: { message: "P0001: Time entry is invoiced" } },
    ];
    queues["time_entries.select"] = [
      { data: [{ import_source_id: "33", duration_min: 120 }], error: null },
    ];
    queues["import_runs.update"] = [{ data: null, error: null }];

    const res = await POST(
      importRequest({
        action: "import",
        timeZone: "UTC",
        userMapping: { "77": "importer" },
      }),
    );
    const json = (await res.json()) as {
      errors: string[];
      imported: { timeEntries: number };
      skipped: { timeEntries: number; reasons: Record<string, number> };
    };
    // A locked row is an expected outcome, not an error.
    expect(json.errors).toEqual([]);
    expect(json.imported.timeEntries).toBe(0);
    expect(json.skipped.timeEntries).toBe(1);
    expect(json.skipped.reasons).toEqual({
      "Already imported and on a non-void invoice — refresh skipped": 1,
    });
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("marks the run failed and returns 500 when the Harvest fetch itself dies; a failing close-out write is logged too", async () => {
    fetchClientsMock.mockRejectedValue(new Error("Harvest exploded"));
    queues["import_runs.insert"] = [{ data: null, error: null }];
    // The failed-marking update itself fails → must be logged, not
    // swallowed (the run would otherwise sit at 'running' forever).
    queues["import_runs.update"] = [
      { data: null, error: { message: "rls denied on update" } },
    ];

    const res = await POST(
      importRequest({ action: "import", userMapping: {} }),
    );
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string; errorCode: string };
    expect(json.error).toBe("Harvest exploded");
    expect(json.errorCode).toBe("unknown");
    const failedMark = calls.find(
      (c) =>
        c.key === "import_runs.update" &&
        (c.payload as Record<string, unknown>).status === "failed",
    );
    expect(failedMark).toBeDefined();
    expect(loggedActions()).toEqual(
      expect.arrayContaining(["harvestImportMarkRunFailed"]),
    );
  });

  it("logs (without failing the import) when the completed close-out write is rejected", async () => {
    queues["import_runs.insert"] = [{ data: null, error: null }];
    queues["customers.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["projects.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["invoices.select"] = [{ data: [], error: null }];
    queues["import_runs.update"] = [
      { data: null, error: { message: "rls denied on update" } },
    ];

    const res = await POST(
      importRequest({ action: "import", userMapping: {} }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);
    expect(loggedActions()).toEqual(["harvestImportCompleteRun"]);
  });

  it("logs when the Harvest Tasks category-set insert fails, and the import still lands the entry uncategorized", async () => {
    fetchClientsMock.mockResolvedValue([harvestClient]);
    fetchProjectsMock.mockResolvedValue([harvestProject]);
    fetchEntriesMock.mockResolvedValue([harvestEntry]);

    queues["import_runs.insert"] = [{ data: null, error: null }];
    queues["customers.select"] = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    queues["customers.insert"] = [{ data: { id: "cust-1" }, error: null }];
    // No existing set, and creating one is denied.
    queues["category_sets.select"] = [{ data: null, error: null }];
    queues["category_sets.insert"] = [
      { data: null, error: { message: "permission denied" } },
    ];
    queues["projects.select"] = [
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            id: "proj-1",
            github_repo: null,
            jira_project_key: null,
            is_internal: false,
          },
        ],
        error: null,
      },
    ];
    queues["projects.insert"] = [{ data: { id: "proj-1" }, error: null }];
    queues["invoices.select"] = [{ data: [], error: null }];
    queues["admin.time_entries.upsert"] = [
      { data: null, error: null, count: 1 },
    ];
    queues["time_entries.select"] = [
      { data: [{ import_source_id: "33", duration_min: 120 }], error: null },
    ];
    queues["import_runs.update"] = [{ data: null, error: null }];

    const res = await POST(
      importRequest({
        action: "import",
        timeZone: "UTC",
        userMapping: { "77": "importer" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      imported: { timeEntries: number };
    };
    expect(json.imported.timeEntries).toBe(1);
    expect(loggedActions()).toContain("harvestImportCategorySet");
    // Entry landed with category_id NULL — degraded, not dropped.
    const upsert = calls.find((c) => c.key === "admin.time_entries.upsert");
    const rows = upsert!.payload as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ category_id: null });
  });
});
