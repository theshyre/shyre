import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock runSafeAction to strip the auth boundary (safe-action.test.ts
// covers the wrapper). Errors propagate so tests can assert on them.
vi.mock("@/lib/safe-action", () => ({
  runSafeAction: async (
    formData: FormData,
    fn: (
      fd: FormData,
      ctx: { supabase: unknown; userId: string },
    ) => Promise<void>,
  ) => {
    await fn(formData, { supabase: supabaseStub, userId: "u-author" });
    return { success: true };
  },
}));

const mockRequireTeamAdmin = vi.fn();
vi.mock("@/lib/team-context", () => ({
  requireTeamAdmin: (...args: unknown[]) => mockRequireTeamAdmin(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const mockRedirect = vi.fn((path: string): never => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

// Admin client shares the same queue-per-table stub — token/event/acceptance
// tables are distinct from the user-client tables, so no cross-talk.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => supabaseStub,
}));

const sendProposalEmailMock = vi.fn().mockResolvedValue({
  outboxId: "ob-1",
  providerMessageId: "pm-1",
});
vi.mock("@/lib/messaging/send-proposal", () => ({
  sendProposalEmail: (...args: unknown[]) => sendProposalEmailMock(...args),
}));

// --- Chainable Supabase stub. Each from(table) call consumes queued results
// FIFO; the builder is thenable so both `.single()` and bare awaits resolve.
interface Result {
  data: unknown;
  error: unknown;
}
interface Call {
  table: string;
  ops: Array<{ method: string; args: unknown[] }>;
}

let queues: Record<string, Result[]> = {};
let calls: Call[] = [];

interface Builder extends PromiseLike<Result> {
  select: (cols?: string) => Builder;
  eq: (col: string, val: unknown) => Builder;
  is: (col: string, val: unknown) => Builder;
  in: (col: string, vals: unknown[]) => Builder;
  order: (col: string, opts?: unknown) => Builder;
  limit: (n: number) => Builder;
  insert: (rows: unknown) => Builder;
  update: (patch: unknown) => Builder;
  delete: () => Builder;
  single: () => Promise<Result>;
  maybeSingle: () => Promise<Result>;
}

function makeBuilder(table: string): Builder {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const resolve = (): Result =>
    queues[table]?.shift() ?? { data: null, error: null };
  const builder: Builder = {
    select: (...args) => {
      call.ops.push({ method: "select", args });
      return builder;
    },
    eq: (...args) => {
      call.ops.push({ method: "eq", args });
      return builder;
    },
    is: (...args) => {
      call.ops.push({ method: "is", args });
      return builder;
    },
    in: (...args) => {
      call.ops.push({ method: "in", args });
      return builder;
    },
    order: (...args) => {
      call.ops.push({ method: "order", args });
      return builder;
    },
    limit: (...args) => {
      call.ops.push({ method: "limit", args });
      return builder;
    },
    insert: (...args) => {
      call.ops.push({ method: "insert", args });
      return builder;
    },
    update: (...args) => {
      call.ops.push({ method: "update", args });
      return builder;
    },
    delete: (...args) => {
      call.ops.push({ method: "delete", args });
      return builder;
    },
    single: () => Promise.resolve(resolve()),
    maybeSingle: () => Promise.resolve(resolve()),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return builder;
}

const supabaseStub = {
  from: (table: string) => makeBuilder(table),
};

import {
  createProposalAction,
  updateProposalAction,
  deleteProposalAction,
  sendProposalAction,
  counterSignProposalAction,
  convertProposalAction,
  createInvoiceFromProposalAction,
  createProposalVersionAction,
} from "./actions";
import { sha256Hex } from "@/lib/proposals/tokens";

const TEAM = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    team_id: TEAM,
    customer_id: CUSTOMER,
    title: "Modernization work",
    deposit_type: "none",
    payment_terms_days: 30,
    items: [
      { title: "Basic dependency upgrades", fixedPrice: 950 },
      {
        title: "Modernize underlying components",
        fixedPrice: 4000,
        isCapped: true,
        phases: [
          { title: "Update the visual framework", fixedPrice: 2200 },
          { title: "Retire older libraries", fixedPrice: 1200 },
          { title: "Refresh code-quality checks", fixedPrice: 600 },
        ],
      },
    ],
    ...overrides,
  });
}

function formWith(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** All insert payloads sent to a table, flattened across calls. */
function insertedRows(table: string): Array<Record<string, unknown>> {
  return calls
    .filter((c) => c.table === table)
    .flatMap((c) => c.ops.filter((o) => o.method === "insert"))
    .flatMap((o) => {
      const rows = o.args[0];
      return Array.isArray(rows)
        ? (rows as Array<Record<string, unknown>>)
        : [rows as Record<string, unknown>];
    });
}

beforeEach(() => {
  queues = {};
  calls = [];
  mockRequireTeamAdmin.mockReset();
  mockRequireTeamAdmin.mockResolvedValue({ userId: "u-author", role: "owner" });
  mockRevalidatePath.mockReset();
  mockRedirect.mockClear();
  sendProposalEmailMock.mockClear();
  process.env.NEXT_PUBLIC_APP_URL = "https://shyre.test";
});

describe("createProposalAction", () => {
  function seedHappyPath(): void {
    queues["customers"] = [{ data: { id: CUSTOMER, team_id: TEAM }, error: null }];
    queues["team_settings"] = [
      { data: { proposal_prefix: "PROP", proposal_next_num: 7 }, error: null },
      { data: null, error: null }, // counter increment
    ];
    queues["proposals"] = [{ data: { id: "prop-1" }, error: null }];
    queues["proposal_line_items"] = [
      { data: [{ id: "li-1" }, { id: "li-2" }], error: null }, // parents
      { data: null, error: null }, // phases
    ];
  }

  it("saves an incomplete draft (no title, no items) — save-as-you-go", async () => {
    queues["customers"] = [{ data: { id: CUSTOMER, team_id: TEAM }, error: null }];
    queues["team_settings"] = [
      { data: { proposal_prefix: "PROP", proposal_next_num: 7 }, error: null },
      { data: null, error: null },
    ];
    queues["proposals"] = [{ data: { id: "prop-1" }, error: null }];

    await expect(
      createProposalAction(
        formWith({
          payload: JSON.stringify({
            team_id: TEAM,
            customer_id: CUSTOMER,
            deposit_type: "none",
            items: [],
          }),
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /proposals/prop-1");

    // Persisted with an empty title (NOT NULL column) and zero line items —
    // no phase-sum / completeness rejection at the draft boundary.
    const [proposalRow] = insertedRows("proposals");
    expect(proposalRow!.title).toBe("");
    expect(insertedRows("proposal_line_items")).toHaveLength(0);
  });

  it("creates the proposal with a generated number and the full item tree", async () => {
    seedHappyPath();
    await expect(
      createProposalAction(formWith({ payload: payload() })),
    ).rejects.toThrow("NEXT_REDIRECT /proposals/prop-1");

    expect(mockRequireTeamAdmin).toHaveBeenCalledWith(TEAM);

    const [proposalRow] = insertedRows("proposals");
    const year = new Date().getFullYear();
    expect(proposalRow).toMatchObject({
      team_id: TEAM,
      user_id: "u-author",
      customer_id: CUSTOMER,
      proposal_number: `PROP-${year}-007`,
      payment_terms_days: 30,
      payment_terms_label: "Net 30",
      deposit_type: "none",
      deposit_value: null,
    });

    const itemRows = insertedRows("proposal_line_items");
    expect(itemRows).toHaveLength(5); // 2 parents + 3 phases
    const parents = itemRows.filter((r) => r.parent_line_item_id === null);
    const phases = itemRows.filter((r) => r.parent_line_item_id !== null);
    expect(parents.map((r) => r.title)).toEqual([
      "Basic dependency upgrades",
      "Modernize underlying components",
    ]);
    // Phases attach to the SECOND parent's returned id.
    expect(new Set(phases.map((r) => r.parent_line_item_id))).toEqual(
      new Set(["li-2"]),
    );
    expect(phases.map((r) => r.fixed_price)).toEqual([2200, 1200, 600]);
    // Every row is team-stamped for RLS/history.
    expect(itemRows.every((r) => r.team_id === TEAM)).toBe(true);

    // Counter incremented to 8.
    const settingsUpdate = calls
      .filter((c) => c.table === "team_settings")
      .flatMap((c) => c.ops.filter((o) => o.method === "update"));
    expect(settingsUpdate[0]?.args[0]).toEqual({ proposal_next_num: 8 });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/proposals");
  });

  it("rejects an invalid payload at the boundary without touching the DB", async () => {
    await expect(
      createProposalAction(formWith({ payload: payload({ items: [] }) })),
    ).rejects.toThrow();
    expect(insertedRows("proposals")).toHaveLength(0);
  });

  it("refuses a customer that belongs to a different team", async () => {
    queues["customers"] = [
      { data: { id: CUSTOMER, team_id: "other-team" }, error: null },
    ];
    await expect(
      createProposalAction(formWith({ payload: payload() })),
    ).rejects.toThrow(/Customer not found on this team/);
    expect(insertedRows("proposals")).toHaveLength(0);
  });

  it("refuses a signer contact that belongs to a different customer", async () => {
    queues["customers"] = [{ data: { id: CUSTOMER, team_id: TEAM }, error: null }];
    queues["customer_contacts"] = [
      { data: { id: CONTACT, customer_id: "someone-else" }, error: null },
    ];
    await expect(
      createProposalAction(
        formWith({ payload: payload({ signer_contact_id: CONTACT }) }),
      ),
    ).rejects.toThrow(/does not belong to this customer/);
    expect(insertedRows("proposals")).toHaveLength(0);
  });
});

describe("updateProposalAction", () => {
  it("refuses to edit a sent proposal", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "sent" }, error: null },
    ];
    await expect(
      updateProposalAction(formWith({ id: "prop-1", payload: payload() })),
    ).rejects.toThrow(/Only draft proposals can be edited/);
  });

  it("refuses a cross-team move", async () => {
    queues["proposals"] = [
      {
        data: { id: "prop-1", team_id: "other-team", status: "draft" },
        error: null,
      },
    ];
    await expect(
      updateProposalAction(formWith({ id: "prop-1", payload: payload() })),
    ).rejects.toThrow(/cannot change teams/);
  });

  it("replaces the line-item tree on a draft and redirects to the detail page", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "draft" }, error: null }, // fetch
      { data: null, error: null }, // update
    ];
    queues["customers"] = [{ data: { id: CUSTOMER, team_id: TEAM }, error: null }];
    queues["proposal_line_items"] = [
      { data: null, error: null }, // delete
      { data: [{ id: "li-9" }, { id: "li-10" }], error: null }, // parents
      { data: null, error: null }, // phases
    ];

    await expect(
      updateProposalAction(formWith({ id: "prop-1", payload: payload() })),
    ).rejects.toThrow("NEXT_REDIRECT /proposals/prop-1");

    const liCalls = calls.filter((c) => c.table === "proposal_line_items");
    expect(
      liCalls.some((c) => c.ops.some((o) => o.method === "delete")),
    ).toBe(true);
    expect(insertedRows("proposal_line_items")).toHaveLength(5);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/proposals/prop-1");
  });

  it("fails when the proposal does not exist", async () => {
    queues["proposals"] = [{ data: null, error: null }];
    await expect(
      updateProposalAction(formWith({ id: "nope", payload: payload() })),
    ).rejects.toThrow(/not found/i);
  });
});

describe("sendProposalAction", () => {
  const draftProposal = {
    id: "prop-1",
    team_id: TEAM,
    status: "draft",
    proposal_number: "PROP-2026-007",
    title: "Modernization",
    customer_id: CUSTOMER,
    signer_contact_id: CONTACT,
  };

  it("mints a hashed token, emails the sign link, flips to sent, logs the event", async () => {
    queues["proposals"] = [
      { data: draftProposal, error: null }, // fetch
      { data: null, error: null }, // status update
    ];
    queues["proposal_line_items"] = [
      // readiness load: one complete top-level item → nothing blocks send
      {
        data: [
          { id: "li-1", parent_line_item_id: null, sort_order: 0, title: "Work", fixed_price: 1000 },
        ],
        error: null,
      },
    ];
    queues["customer_contacts"] = [
      {
        data: {
          id: CONTACT,
          name: "Jordan Chen",
          email: "jordan@eyereg.example",
          customer_id: CUSTOMER,
        },
        error: null,
      },
    ];
    queues["proposal_access_tokens"] = [{ data: null, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];

    await sendProposalAction(formWith({ id: "prop-1" }));

    // Token: stored hash must be sha256 of the raw token in the emailed URL.
    const tokenInsert = insertedRows("proposal_access_tokens")[0]!;
    expect(tokenInsert.signer_email).toBe("jordan@eyereg.example");
    expect(tokenInsert.token_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(sendProposalEmailMock).toHaveBeenCalledTimes(1);
    const emailInput = sendProposalEmailMock.mock.calls[0]![1] as {
      kind: string;
      toEmail: string;
      bodyText: string;
    };
    expect(emailInput.kind).toBe("proposal");
    expect(emailInput.toEmail).toBe("jordan@eyereg.example");
    const rawToken = /https:\/\/shyre\.test\/sign\/([A-Za-z0-9_-]+)/.exec(
      emailInput.bodyText,
    )?.[1];
    expect(rawToken).toBeDefined();
    expect(sha256Hex(rawToken!)).toBe(tokenInsert.token_hash);

    // Status flipped to sent + event logged with the ADMIN-side actor.
    const statusUpdate = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { status?: string }).status === "sent",
        ),
    );
    expect(statusUpdate).toBeDefined();
    const eventInsert = insertedRows("proposal_events")[0]!;
    expect(eventInsert.event_type).toBe("sent");
    expect(eventInsert.actor_user_id).toBe("u-author");
  });

  it("refuses without a signer contact (readiness gate)", async () => {
    queues["proposals"] = [
      { data: { ...draftProposal, signer_contact_id: null }, error: null },
    ];
    // Title + a complete item present, so the ONLY blocker is the signer.
    queues["proposal_line_items"] = [
      {
        data: [
          { id: "li-1", parent_line_item_id: null, sort_order: 0, title: "Work", fixed_price: 1000 },
        ],
        error: null,
      },
    ];
    await expect(
      sendProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/isn't ready to send/);
    expect(sendProposalEmailMock).not.toHaveBeenCalled();
  });

  it("refuses an incomplete draft (no line items) before sending", async () => {
    queues["proposals"] = [{ data: draftProposal, error: null }];
    queues["proposal_line_items"] = [{ data: [], error: null }]; // nothing yet
    await expect(
      sendProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/isn't ready to send/);
    expect(sendProposalEmailMock).not.toHaveBeenCalled();
  });

  it("refuses to re-send a non-draft proposal", async () => {
    queues["proposals"] = [
      { data: { ...draftProposal, status: "sent" }, error: null },
    ];
    await expect(
      sendProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/Only a draft proposal can be sent/);
  });

  it("keeps the draft editable when the email fails (no status flip)", async () => {
    sendProposalEmailMock.mockRejectedValueOnce(new Error("resend down"));
    queues["proposals"] = [{ data: draftProposal, error: null }];
    queues["proposal_line_items"] = [
      {
        data: [
          { id: "li-1", parent_line_item_id: null, sort_order: 0, title: "Work", fixed_price: 1000 },
        ],
        error: null,
      },
    ];
    queues["customer_contacts"] = [
      {
        data: {
          id: CONTACT,
          name: "Jordan Chen",
          email: "jordan@eyereg.example",
          customer_id: CUSTOMER,
        },
        error: null,
      },
    ];
    queues["proposal_access_tokens"] = [{ data: null, error: null }];

    await expect(
      sendProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/resend down/);
    const statusUpdate = calls.find(
      (c) =>
        c.table === "proposals" && c.ops.some((o) => o.method === "update"),
    );
    expect(statusUpdate).toBeUndefined();
  });
});

describe("counterSignProposalAction", () => {
  it("stamps the provider signature and logs countersigned", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "accepted" }, error: null },
    ];
    queues["proposal_acceptances"] = [
      {
        data: { id: "acc-1", decision: "accepted", provider_signed_at: null },
        error: null,
      },
      { data: null, error: null }, // update
    ];
    queues["proposal_events"] = [{ data: null, error: null }];

    await counterSignProposalAction(formWith({ id: "prop-1" }));

    const update = calls
      .filter((c) => c.table === "proposal_acceptances")
      .flatMap((c) => c.ops.filter((o) => o.method === "update"))
      .map((o) => o.args[0] as { provider_signed_by_user_id?: string })[0];
    expect(update?.provider_signed_by_user_id).toBe("u-author");
    expect(insertedRows("proposal_events")[0]?.event_type).toBe(
      "countersigned",
    );
  });

  it("refuses a double counter-sign", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "accepted" }, error: null },
    ];
    queues["proposal_acceptances"] = [
      {
        data: {
          id: "acc-1",
          decision: "accepted",
          provider_signed_at: "2026-07-16T00:00:00Z",
        },
        error: null,
      },
    ];
    await expect(
      counterSignProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/already counter-signed/);
  });

  it("refuses when nothing was accepted", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "sent" }, error: null },
    ];
    queues["proposal_acceptances"] = [{ data: null, error: null }];
    await expect(
      counterSignProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/No accepted sign-off/);
  });
});

// The kickoff-example item tree: li-1 unphased $950, li-2 phased $4,000.
const CONVERT_ITEMS = [
  { id: "li-1", parent_line_item_id: null, sort_order: 0, title: "Basic dependency upgrades", description: "Upgrades", fixed_price: 950, converted_project_id: null, invoiced_at: null },
  { id: "li-2", parent_line_item_id: null, sort_order: 1, title: "Modernize underlying components", description: null, fixed_price: 4000, converted_project_id: null, invoiced_at: null },
  { id: "li-3", parent_line_item_id: "li-2", sort_order: 0, title: "Update the visual framework", description: null, fixed_price: 2200, converted_project_id: null, invoiced_at: null },
  { id: "li-4", parent_line_item_id: "li-2", sort_order: 1, title: "Retire older libraries", description: null, fixed_price: 1200, converted_project_id: null, invoiced_at: null },
  { id: "li-5", parent_line_item_id: "li-2", sort_order: 2, title: "Refresh code-quality checks", description: null, fixed_price: 600, converted_project_id: null, invoiced_at: null },
];

describe("convertProposalAction", () => {
  const acceptedProposal = {
    id: "prop-1",
    team_id: TEAM,
    status: "accepted",
    customer_id: CUSTOMER,
    proposal_number: "PROP-2026-007",
  };

  it("creates a project per accepted item, phases as sub-projects, links them back, flips to converted", async () => {
    queues["proposals"] = [
      { data: acceptedProposal, error: null },
      { data: null, error: null }, // status → converted
    ];
    queues["proposal_acceptances"] = [
      { data: [{ selected_line_item_ids: ["li-1", "li-2"], decision: "accepted" }], error: null },
    ];
    queues["proposal_line_items"] = [{ data: CONVERT_ITEMS, error: null }];
    queues["projects"] = [
      { data: { id: "p-1" }, error: null }, // li-1
      { data: { id: "p-2" }, error: null }, // li-2 parent
      { data: { id: "p-3" }, error: null }, // phase 1
      { data: { id: "p-4" }, error: null }, // phase 2
      { data: { id: "p-5" }, error: null }, // phase 3
    ];
    queues["proposal_events"] = [{ data: null, error: null }];

    await convertProposalAction(formWith({ id: "prop-1" }));

    const projectInserts = insertedRows("projects");
    expect(projectInserts).toHaveLength(5);
    expect(projectInserts[0]).toMatchObject({
      name: "Basic dependency upgrades",
      customer_id: CUSTOMER,
      team_id: TEAM,
      is_internal: false,
      default_billable: true,
    });
    // The three phases hang under li-2's project.
    const subs = projectInserts.filter((p) => p.parent_project_id === "p-2");
    expect(subs.map((s) => s.name)).toEqual([
      "Update the visual framework",
      "Retire older libraries",
      "Refresh code-quality checks",
    ]);

    // Line items linked back to their created projects.
    const liUpdates = calls
      .filter((c) => c.table === "proposal_line_items")
      .flatMap((c) => c.ops.filter((o) => o.method === "update"))
      .map((o) => o.args[0] as { converted_project_id?: string });
    expect(liUpdates.map((u) => u.converted_project_id)).toEqual([
      "p-1",
      "p-2",
      "p-3",
      "p-4",
      "p-5",
    ]);

    const statusUpdate = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { status?: string }).status === "converted",
        ),
    );
    expect(statusUpdate).toBeDefined();
    expect(insertedRows("proposal_events")[0]).toMatchObject({
      event_type: "converted",
      metadata: { projects_created: 5 },
    });
  });

  it("refuses when the proposal isn't accepted", async () => {
    queues["proposals"] = [
      { data: { ...acceptedProposal, status: "sent" }, error: null },
    ];
    await expect(
      convertProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/Only an accepted proposal/);
  });

  it("refuses when there is no accepted sign-off", async () => {
    queues["proposals"] = [{ data: acceptedProposal, error: null }];
    queues["proposal_acceptances"] = [{ data: null, error: null }];
    await expect(
      convertProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/No accepted sign-off/);
  });

  it("refuses a double convert (everything already linked)", async () => {
    queues["proposals"] = [{ data: acceptedProposal, error: null }];
    queues["proposal_acceptances"] = [
      { data: [{ selected_line_item_ids: ["li-1"], decision: "accepted" }], error: null },
    ];
    queues["proposal_line_items"] = [
      {
        data: [{ ...CONVERT_ITEMS[0]!, converted_project_id: "p-old" }],
        error: null,
      },
    ];
    await expect(
      convertProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/already been converted/);
    expect(insertedRows("projects")).toHaveLength(0);
  });
});

describe("createInvoiceFromProposalAction", () => {
  const acceptedProposal = {
    id: "prop-1",
    team_id: TEAM,
    status: "accepted",
    customer_id: CUSTOMER,
    proposal_number: "PROP-2026-007",
    title: "Modernization",
    currency: "USD",
    payment_terms_days: 30,
    payment_terms_label: "Net 30",
  };

  // The atomic claim (UPDATE ... WHERE invoiced_at IS NULL RETURNING) resolves
  // to the rows it actually locked — id + title + fixed_price.
  const claimedTopLevel = [
    { id: "li-1", title: "Basic dependency upgrades", fixed_price: 950 },
    { id: "li-2", title: "Modernize underlying components", fixed_price: 4000 },
  ];

  function seedBillable(acceptanceTaxRate: number | null = 0): void {
    queues["proposals"] = [{ data: acceptedProposal, error: null }];
    queues["proposal_acceptances"] = [
      {
        data: [
          {
            selected_line_item_ids: ["li-1", "li-2"],
            decision: "accepted",
            tax_rate: acceptanceTaxRate,
          },
        ],
        error: null,
      },
    ];
    queues["proposal_line_items"] = [
      { data: CONVERT_ITEMS, error: null }, // loadAcceptedSelection read
      { data: claimedTopLevel, error: null }, // atomic claim RETURNING
    ];
    queues["team_settings"] = [
      { data: { invoice_prefix: "INV", invoice_next_num: 42, tax_rate: 0 }, error: null },
      { data: null, error: null }, // counter increment
    ];
    queues["invoices"] = [{ data: { id: "inv-1" }, error: null }];
    queues["invoice_line_items"] = [{ data: null, error: null }];
  }

  it("bills the accepted subset as manual lines with proposal terms — $4,950", async () => {
    seedBillable();
    await expect(
      createInvoiceFromProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow("NEXT_REDIRECT /invoices/inv-1");

    const year = new Date().getFullYear();
    const [invoiceRow] = insertedRows("invoices");
    expect(invoiceRow).toMatchObject({
      team_id: TEAM,
      customer_id: CUSTOMER,
      // Structured back-link + currency carried through from the proposal.
      proposal_id: "prop-1",
      currency: "USD",
      invoice_number: `INV-${year}-042`,
      status: "draft",
      subtotal: 4950,
      total: 4950,
      payment_terms_days: 30,
      payment_terms_label: "Net 30",
      grouping_mode: "detailed",
    });
    expect(invoiceRow!.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const lineRows = insertedRows("invoice_line_items");
    expect(lineRows).toHaveLength(2);
    // Source lines: time-entry / expense FKs null (the mutex CHECK's third
    // case), but the proposal line item IS linked for reconciliation + unlock.
    expect(
      lineRows.every(
        (r) => r.time_entry_id === null && r.expense_id === null,
      ),
    ).toBe(true);
    expect(lineRows.map((r) => r.proposal_line_item_id)).toEqual(["li-1", "li-2"]);
    expect(lineRows.map((r) => r.amount)).toEqual([950, 4000]);
    expect(lineRows[0]!.description).toContain("PROP-2026-007");

    // Double-bill lock: a SINGLE atomic claim stamps invoiced_at across both
    // items, guarded by `invoiced_at IS NULL` so concurrent bills can't race.
    const claims = calls
      .filter((c) => c.table === "proposal_line_items")
      .filter((c) =>
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { invoiced_at?: string }).invoiced_at != null,
        ),
      );
    expect(claims).toHaveLength(1);
    const claim = claims[0]!;
    expect(claim.ops.some((o) => o.method === "is" && o.args[0] === "invoiced_at")).toBe(true);
    expect(claim.ops.find((o) => o.method === "in")!.args[1]).toEqual(["li-1", "li-2"]);
  });

  it("bills at the tax rate frozen when the client signed, not the team default", async () => {
    // Team default is 0 (seedBillable), but the signature froze 10% — the bill
    // must honor what the client actually authorized.
    seedBillable(10);
    await expect(
      createInvoiceFromProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow("NEXT_REDIRECT /invoices/inv-1");

    const [invoiceRow] = insertedRows("invoices");
    expect(invoiceRow).toMatchObject({
      tax_rate: 10,
      subtotal: 4950,
      tax_amount: 495,
      total: 5445,
    });
  });

  it("rolls back the double-bill lock when invoice assembly fails", async () => {
    seedBillable();
    // Invoice insert errors after the claim is taken.
    queues["invoices"] = [{ data: null, error: { message: "insert boom" } }];
    await expect(
      createInvoiceFromProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow();

    // The claim stamped invoiced_at; the catch must clear it back to null so
    // the work isn't stranded "billed" against a non-existent invoice.
    const releases = calls
      .filter((c) => c.table === "proposal_line_items")
      .flatMap((c) => c.ops.filter((o) => o.method === "update"))
      .map((o) => o.args[0] as { invoiced_at?: string | null })
      .filter((p) => p.invoiced_at === null);
    expect(releases).toHaveLength(1);
  });

  it("refuses when everything accepted is already invoiced", async () => {
    queues["proposals"] = [{ data: acceptedProposal, error: null }];
    queues["proposal_acceptances"] = [
      { data: [{ selected_line_item_ids: ["li-1"], decision: "accepted" }], error: null },
    ];
    queues["proposal_line_items"] = [
      {
        data: [{ ...CONVERT_ITEMS[0]!, invoiced_at: "2026-07-16T00:00:00Z" }],
        error: null,
      },
    ];
    await expect(
      createInvoiceFromProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/already been invoiced/);
    expect(insertedRows("invoices")).toHaveLength(0);
  });

  it("refuses to bill an unaccepted proposal", async () => {
    queues["proposals"] = [
      { data: { ...acceptedProposal, status: "viewed" }, error: null },
    ];
    await expect(
      createInvoiceFromProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/Only an accepted proposal can be billed/);
  });
});

describe("createProposalVersionAction", () => {
  const sentProposal = {
    id: "prop-1",
    team_id: TEAM,
    status: "sent",
    customer_id: CUSTOMER,
    signer_contact_id: CONTACT,
    proposal_number: "PROP-2026-007",
    title: "Modernization",
    valid_until: "2026-08-15",
    payment_terms_days: 30,
    payment_terms_label: "Net 30",
    deposit_type: "none",
    deposit_value: null,
    warranty_days: 30,
    terms_notes: null,
    currency: "USD",
    version_number: 1,
  };

  it("copies the document to a new draft, supersedes the source, revokes its links", async () => {
    queues["proposals"] = [
      { data: sentProposal, error: null }, // source fetch
      { data: { id: "prop-2" }, error: null }, // new version insert
      { data: null, error: null }, // superseded status flip
    ];
    queues["team_settings"] = [
      { data: { proposal_prefix: "PROP", proposal_next_num: 8 }, error: null },
      { data: null, error: null }, // counter increment
    ];
    queues["proposal_line_items"] = [
      { data: CONVERT_ITEMS, error: null }, // source items
      { data: [{ id: "nli-1" }, { id: "nli-2" }], error: null }, // new parents
      { data: null, error: null }, // new phases
    ];
    queues["proposal_access_tokens"] = [{ data: null, error: null }]; // revoke
    queues["proposal_events"] = [{ data: null, error: null }];

    await expect(
      createProposalVersionAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow("NEXT_REDIRECT /proposals/prop-2/edit");

    const [versionRow] = insertedRows("proposals");
    expect(versionRow).toMatchObject({
      supersedes_proposal_id: "prop-1",
      version_number: 2,
      title: "Modernization",
      payment_terms_days: 30,
    });
    // The item tree is copied: 2 parents + 3 phases remapped to new parents.
    const copied = insertedRows("proposal_line_items");
    expect(copied).toHaveLength(5);
    expect(
      copied.filter((r) => r.parent_line_item_id === "nli-2"),
    ).toHaveLength(3);

    // Old doc superseded + its outstanding links revoked.
    const supersede = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { status?: string }).status === "superseded",
        ),
    );
    expect(supersede).toBeDefined();
    const revoke = calls.find(
      (c) =>
        c.table === "proposal_access_tokens" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { revoked_at?: string }).revoked_at,
        ),
    );
    expect(revoke).toBeDefined();
    expect(insertedRows("proposal_events")[0]?.event_type).toBe("superseded");
  });

  it("declined source: links the version but keeps declined (terminal) and revokes nothing", async () => {
    queues["proposals"] = [
      { data: { ...sentProposal, status: "declined" }, error: null },
      { data: { id: "prop-2" }, error: null },
    ];
    queues["team_settings"] = [
      { data: { proposal_prefix: "PROP", proposal_next_num: 8 }, error: null },
      { data: null, error: null },
    ];
    queues["proposal_line_items"] = [
      { data: [], error: null }, // no items edge case
    ];
    queues["proposal_events"] = [{ data: null, error: null }];

    await expect(
      createProposalVersionAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow("NEXT_REDIRECT /proposals/prop-2/edit");

    const supersede = calls.find(
      (c) =>
        c.table === "proposals" &&
        c.ops.some(
          (o) =>
            o.method === "update" &&
            (o.args[0] as { status?: string }).status === "superseded",
        ),
    );
    expect(supersede).toBeUndefined();
  });

  it("refuses drafts (just edit them) and signed work", async () => {
    queues["proposals"] = [
      { data: { ...sentProposal, status: "draft" }, error: null },
    ];
    await expect(
      createProposalVersionAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/still editable/);

    queues["proposals"] = [
      { data: { ...sentProposal, status: "accepted" }, error: null },
    ];
    await expect(
      createProposalVersionAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/can't be revised/);
  });
});

describe("deleteProposalAction", () => {
  it("deletes a draft and redirects to the list", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "draft" }, error: null },
      { data: null, error: null }, // delete
    ];
    await expect(
      deleteProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow("NEXT_REDIRECT /proposals");
    const delCall = calls.find(
      (c) =>
        c.table === "proposals" && c.ops.some((o) => o.method === "delete"),
    );
    expect(delCall).toBeDefined();
  });

  it("refuses to delete anything past draft — it's part of the audit record", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "accepted" }, error: null },
    ];
    await expect(
      deleteProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/Only draft proposals can be deleted/);
  });
});
