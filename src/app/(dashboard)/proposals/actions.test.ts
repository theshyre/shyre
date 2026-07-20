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
  resendSignLinksAction,
  createProposalAction,
  updateProposalAction,
  deleteProposalAction,
  bulkDeleteProposalsAction,
  sendProposalAction,
  counterSignProposalAction,
  convertProposalAction,
  createInvoiceFromProposalAction,
  createProposalVersionAction,
  overrideProposalSignoffAction,
} from "./actions";
import { sha256Hex } from "@/lib/proposals/tokens";

const TEAM = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const CONTACT2 = "44444444-4444-4444-8444-444444444444";

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

/** Bulk actions post repeated `id` fields (FormData.append, not .set). */
function formWithIds(ids: string[]): FormData {
  const fd = new FormData();
  for (const id of ids) fd.append("id", id);
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

  it("writes the signer roster (in order) and mirrors the primary + mode when 2+ signers", async () => {
    queues["customers"] = [{ data: { id: CUSTOMER, team_id: TEAM }, error: null }];
    queues["customer_contacts"] = [
      {
        data: [
          { id: CONTACT, customer_id: CUSTOMER },
          { id: CONTACT2, customer_id: CUSTOMER },
        ],
        error: null,
      },
    ];
    queues["team_settings"] = [
      { data: { proposal_prefix: "PROP", proposal_next_num: 7 }, error: null },
      { data: null, error: null },
    ];
    queues["proposals"] = [{ data: { id: "prop-1" }, error: null }];
    queues["proposal_line_items"] = [
      { data: [{ id: "li-1" }, { id: "li-2" }], error: null },
      { data: null, error: null },
    ];

    await expect(
      createProposalAction(
        formWith({
          payload: payload({ signers: [CONTACT, CONTACT2], signing_mode: "all" }),
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /proposals/prop-1");

    const [proposalRow] = insertedRows("proposals");
    expect(proposalRow!.signer_contact_id).toBe(CONTACT); // primary = roster[0]
    expect(proposalRow!.signing_mode).toBe("all");
    const roster = insertedRows("proposal_signers");
    expect(roster.map((r) => r.contact_id)).toEqual([CONTACT, CONTACT2]);
    expect(roster.map((r) => r.sort_order)).toEqual([0, 1]);
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
    // assertCustomerAndSigner validates all signer ids via `.in()` (array).
    queues["customer_contacts"] = [
      { data: [{ id: CONTACT, customer_id: "someone-else" }], error: null },
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

  it("mints a token + email per roster signer (multi-signer)", async () => {
    queues["proposals"] = [
      { data: { ...draftProposal, signing_mode: "all" }, error: null },
      { data: null, error: null }, // status update
    ];
    queues["proposal_line_items"] = [
      {
        data: [
          { id: "li-1", parent_line_item_id: null, sort_order: 0, title: "Work", fixed_price: 1000 },
        ],
        error: null,
      },
    ];
    queues["proposal_signers"] = [
      {
        data: [
          { id: "sgnr-1", sort_order: 0, customer_contacts: { name: "Ada", email: "ada@eyereg.example", customer_id: CUSTOMER } },
          { id: "sgnr-2", sort_order: 1, customer_contacts: { name: "Bram", email: "bram@eyereg.example", customer_id: CUSTOMER } },
        ],
        error: null,
      },
    ];
    queues["proposal_events"] = [{ data: null, error: null }];

    await sendProposalAction(formWith({ id: "prop-1" }));

    // One token per signer, each carrying its signer_id + email.
    const tokens = insertedRows("proposal_access_tokens");
    expect(tokens).toHaveLength(2);
    expect(tokens.map((t) => t.signer_id)).toEqual(["sgnr-1", "sgnr-2"]);
    expect(tokens.map((t) => t.signer_email)).toEqual([
      "ada@eyereg.example",
      "bram@eyereg.example",
    ]);
    // One sign-link email per signer.
    expect(sendProposalEmailMock).toHaveBeenCalledTimes(2);
  });

  it("refuses the whole send when ANY roster contact belongs to a different customer — no tokens, no emails", async () => {
    // Cross-customer contact smuggled into the roster (e.g. a stale
    // roster row after the contact was moved): the send must refuse
    // atomically. In particular the FIRST (valid) signer must not have
    // already received a live sign link.
    queues["proposals"] = [
      { data: { ...draftProposal, signing_mode: "all" }, error: null },
    ];
    queues["proposal_line_items"] = [
      {
        data: [
          { id: "li-1", parent_line_item_id: null, sort_order: 0, title: "Work", fixed_price: 1000 },
        ],
        error: null,
      },
    ];
    queues["proposal_signers"] = [
      {
        data: [
          { id: "sgnr-1", sort_order: 0, customer_contacts: { name: "Ada", email: "ada@eyereg.example", customer_id: CUSTOMER } },
          { id: "sgnr-2", sort_order: 1, customer_contacts: { name: "Mallory", email: "mallory@other.example", customer_id: "not-this-customer" } },
        ],
        error: null,
      },
    ];

    await expect(
      sendProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/does not belong to this customer/);

    // Nothing left the building: no access token minted (not even for
    // the valid first signer), no email, no status flip.
    expect(insertedRows("proposal_access_tokens")).toHaveLength(0);
    expect(sendProposalEmailMock).not.toHaveBeenCalled();
    expect(
      calls.some(
        (c) =>
          c.table === "proposals" && c.ops.some((o) => o.method === "update"),
      ),
    ).toBe(false);
  });

  it("refuses a roster row whose contact join came back empty (deleted contact)", async () => {
    queues["proposals"] = [
      { data: { ...draftProposal, signing_mode: "all" }, error: null },
    ];
    queues["proposal_line_items"] = [
      {
        data: [
          { id: "li-1", parent_line_item_id: null, sort_order: 0, title: "Work", fixed_price: 1000 },
        ],
        error: null,
      },
    ];
    queues["proposal_signers"] = [
      {
        data: [{ id: "sgnr-1", sort_order: 0, customer_contacts: null }],
        error: null,
      },
    ];

    await expect(
      sendProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/does not belong to this customer/);
    expect(insertedRows("proposal_access_tokens")).toHaveLength(0);
    expect(sendProposalEmailMock).not.toHaveBeenCalled();
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

describe("overrideProposalSignoffAction", () => {
  /** A stalled all-mode deal: primary (sgn-1) accepted, co-signer (sgn-2)
   *  hasn't. Wires the queues loadProposalRoster + the acceptance read need. */
  function seedStalled(overrides: { signingMode?: string; status?: string } = {}): void {
    queues["proposals"] = [
      {
        data: {
          id: "prop-1",
          team_id: TEAM,
          status: overrides.status ?? "viewed",
          signing_mode: overrides.signingMode ?? "all",
        },
        error: null,
      },
      { data: null, error: null }, // status update
    ];
    queues["proposal_signers"] = [
      {
        data: [
          { id: "sgn-1", sort_order: 0, customer_contacts: { name: "Bret Andre", email: "bret@eyereg.test", role_label: "President" } },
          { id: "sgn-2", sort_order: 1, customer_contacts: { name: "Mijeong Andre", email: "mij@eyereg.test", role_label: null } },
        ],
        error: null,
      },
    ];
    queues["proposal_acceptances"] = [
      {
        data: [
          { signer_id: "sgn-1", decision: "accepted", accepted_total: 7450, signer_name: "Bret Andre" },
        ],
        error: null,
      },
    ];
    queues["proposal_access_tokens"] = [{ data: null, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];
  }

  it("completes a stalled multi-signer deal on the primary's total + records an audited event", async () => {
    seedStalled();
    await overrideProposalSignoffAction(
      formWith({ id: "prop-1", note: "Co-signer left the company." }),
    );

    const update = calls
      .filter((c) => c.table === "proposals")
      .flatMap((c) => c.ops.filter((o) => o.method === "update"))
      .map((o) => o.args[0] as { status?: string; accepted_total?: number })[0];
    expect(update?.status).toBe("accepted");
    expect(update?.accepted_total).toBe(7450);

    const event = insertedRows("proposal_events")[0];
    expect(event?.event_type).toBe("signoff_overridden");
    expect(event?.actor_user_id).toBe("u-author");
    const meta = event?.metadata as {
      note: string;
      waived_signers: string[];
    };
    expect(meta.note).toBe("Co-signer left the company.");
    expect(meta.waived_signers).toEqual(["Mijeong Andre"]);

    // The holdout's outstanding link is revoked so a late click can't compete.
    const tokenUpdate = calls
      .filter((c) => c.table === "proposal_access_tokens")
      .flatMap((c) => c.ops.filter((o) => o.method === "update"))
      .map((o) => o.args[0] as { revoked_at?: string })[0];
    expect(tokenUpdate?.revoked_at).toBeTruthy();
  });

  it("requires a reason note", async () => {
    seedStalled();
    await expect(
      overrideProposalSignoffAction(formWith({ id: "prop-1", note: "x" })),
    ).rejects.toThrow(/reason/i);
  });

  it("refuses when the proposal is not in all-mode", async () => {
    seedStalled({ signingMode: "first" });
    await expect(
      overrideProposalSignoffAction(
        formWith({ id: "prop-1", note: "changed our mind" }),
      ),
    ).rejects.toThrow(/every signer/i);
  });

  it("refuses once the proposal is already decided", async () => {
    seedStalled({ status: "accepted" });
    await expect(
      overrideProposalSignoffAction(
        formWith({ id: "prop-1", note: "changed our mind" }),
      ),
    ).rejects.toThrow(/in-flight/i);
  });

  it("refuses when nobody has signed yet (nothing to stand on)", async () => {
    seedStalled();
    // No accepted acceptances.
    queues["proposal_acceptances"] = [{ data: [], error: null }];
    await expect(
      overrideProposalSignoffAction(
        formWith({ id: "prop-1", note: "changed our mind" }),
      ),
    ).rejects.toThrow(/nobody|no one/i);
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

  it("carries the multi-signer roster + signing mode forward to the new version", async () => {
    queues["proposals"] = [
      { data: { ...sentProposal, signing_mode: "all" }, error: null }, // source
      { data: { id: "prop-2" }, error: null }, // new version insert
      { data: null, error: null }, // superseded flip
    ];
    queues["team_settings"] = [
      { data: { proposal_prefix: "PROP", proposal_next_num: 8 }, error: null },
      { data: null, error: null },
    ];
    queues["proposal_line_items"] = [{ data: [], error: null }]; // no items
    queues["proposal_signers"] = [
      {
        data: [
          { contact_id: "c-1", sort_order: 0 },
          { contact_id: "c-2", sort_order: 1 },
        ],
        error: null,
      }, // source roster
      { data: null, error: null }, // roster insert
    ];
    queues["proposal_access_tokens"] = [{ data: null, error: null }];
    queues["proposal_events"] = [{ data: null, error: null }];

    await expect(
      createProposalVersionAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow("NEXT_REDIRECT /proposals/prop-2/edit");

    // Signing mode carried forward…
    expect(insertedRows("proposals")[0]).toMatchObject({ signing_mode: "all" });
    // …and the full roster re-created for the new version (not just the primary).
    const roster = insertedRows("proposal_signers");
    expect(roster).toHaveLength(2);
    expect(roster.map((r) => r.contact_id)).toEqual(["c-1", "c-2"]);
    expect(roster.every((r) => r.proposal_id === "prop-2")).toBe(true);
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

  it("also deletes a superseded version (e.g. clearing out test proposals)", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "superseded" }, error: null },
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

  it("refuses to delete a sent/decided proposal — it's part of the audit record", async () => {
    queues["proposals"] = [
      { data: { id: "prop-1", team_id: TEAM, status: "accepted" }, error: null },
    ];
    await expect(
      deleteProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/audit record/);
  });
});

describe("bulkDeleteProposalsAction", () => {
  it("deletes only the deletable rows and reports an honest { deleted, skipped } count", async () => {
    queues["proposals"] = [
      {
        data: [
          { id: "p-draft", team_id: TEAM, status: "draft" },
          { id: "p-superseded", team_id: TEAM, status: "superseded" },
          { id: "p-sent", team_id: TEAM, status: "sent" },
        ],
        error: null,
      }, // select
      { data: null, error: null }, // delete
    ];

    const result = await bulkDeleteProposalsAction(
      formWithIds(["p-draft", "p-superseded", "p-sent"]),
    );

    expect(result).toEqual({ success: true, deleted: 2, skipped: 1 });
    const delCall = calls.find(
      (c) =>
        c.table === "proposals" && c.ops.some((o) => o.method === "delete"),
    );
    expect(delCall).toBeDefined();
    const inOp = delCall!.ops.find((o) => o.method === "in");
    expect(inOp!.args[1]).toEqual(["p-draft", "p-superseded"]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/proposals");
  });

  it("re-checks status server-side instead of trusting a stale client selection", async () => {
    // The row was "draft" when the page loaded but was sent in the
    // meantime — the server must skip it, not delete it, even though the
    // client believed it was eligible when the checkbox was checked.
    queues["proposals"] = [
      { data: [{ id: "p-1", team_id: TEAM, status: "sent" }], error: null },
    ];
    const result = await bulkDeleteProposalsAction(formWithIds(["p-1"]));
    expect(result).toEqual({ success: true, deleted: 0, skipped: 1 });
    const delCall = calls.find(
      (c) =>
        c.table === "proposals" && c.ops.some((o) => o.method === "delete"),
    );
    expect(delCall).toBeUndefined();
  });

  it("skips everything and deletes nothing when no selected row is deletable", async () => {
    queues["proposals"] = [
      {
        data: [
          { id: "p-1", team_id: TEAM, status: "accepted" },
          { id: "p-2", team_id: TEAM, status: "converted" },
        ],
        error: null,
      },
    ];
    const result = await bulkDeleteProposalsAction(
      formWithIds(["p-1", "p-2"]),
    );
    expect(result).toEqual({ success: true, deleted: 0, skipped: 2 });
    // Nothing changed, so no need to revalidate.
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("requires team-admin access on every distinct team represented in the selection", async () => {
    queues["proposals"] = [
      {
        data: [
          { id: "p-1", team_id: TEAM, status: "draft" },
          { id: "p-2", team_id: "other-team", status: "draft" },
        ],
        error: null,
      },
      { data: null, error: null }, // delete
    ];
    await bulkDeleteProposalsAction(formWithIds(["p-1", "p-2"]));
    expect(mockRequireTeamAdmin).toHaveBeenCalledWith(TEAM);
    expect(mockRequireTeamAdmin).toHaveBeenCalledWith("other-team");
  });

  it("propagates a denied admin gate without deleting anything", async () => {
    queues["proposals"] = [
      { data: [{ id: "p-1", team_id: TEAM, status: "draft" }], error: null },
    ];
    mockRequireTeamAdmin.mockRejectedValueOnce(
      new Error("Only team owners and admins can perform this action."),
    );
    await expect(
      bulkDeleteProposalsAction(formWithIds(["p-1"])),
    ).rejects.toThrow(/owners and admins/);
    const delCall = calls.find(
      (c) =>
        c.table === "proposals" && c.ops.some((o) => o.method === "delete"),
    );
    expect(delCall).toBeUndefined();
  });

  it("no-ops cleanly on an empty selection without touching the DB", async () => {
    const result = await bulkDeleteProposalsAction(formWithIds([]));
    expect(result).toEqual({ success: true, deleted: 0, skipped: 0 });
    expect(calls).toHaveLength(0);
  });

  it("de-duplicates repeated ids in the form payload", async () => {
    queues["proposals"] = [
      { data: [{ id: "p-1", team_id: TEAM, status: "draft" }], error: null },
      { data: null, error: null }, // delete
    ];
    const fd = new FormData();
    fd.append("id", "p-1");
    fd.append("id", "p-1");
    const result = await bulkDeleteProposalsAction(fd);
    expect(result).toEqual({ success: true, deleted: 1, skipped: 0 });
  });
});

describe("resendSignLinksAction", () => {
  const sentProposalRow = {
    id: "prop-1",
    team_id: TEAM,
    status: "sent",
    proposal_number: "PROP-2026-007",
    title: "Modernization",
    signing_mode: "first",
  };

  it("revokes outstanding tokens, mints + emails fresh ones, logs link_resent", async () => {
    queues["proposals"] = [{ data: sentProposalRow, error: null }];
    queues["proposal_access_tokens"] = [
      {
        data: [
          { id: "tok-1", signer_id: null, signer_email: "j@x.com", signer_name: "Jordan" },
        ],
        error: null,
      }, // pending lookup
      { data: null, error: null }, // revoke update
      { data: null, error: null }, // fresh insert
    ];
    queues["proposal_events"] = [{ data: null, error: null }];

    await resendSignLinksAction(formWith({ id: "prop-1" }));

    // Old token revoked BEFORE the new one exists.
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
    const minted = insertedRows("proposal_access_tokens");
    expect(minted).toHaveLength(1);
    expect(minted[0]).toMatchObject({ signer_email: "j@x.com" });
    // A fresh HASH is stored, never a raw token.
    expect(String(minted[0]!.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(sendProposalEmailMock).toHaveBeenCalledTimes(1);
    expect(insertedRows("proposal_events")[0]?.event_type).toBe("link_resent");
  });

  it("refuses when there are no outstanding links", async () => {
    queues["proposals"] = [{ data: sentProposalRow, error: null }];
    queues["proposal_access_tokens"] = [{ data: [], error: null }];
    await expect(
      resendSignLinksAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/No outstanding/);
    expect(sendProposalEmailMock).not.toHaveBeenCalled();
  });

  it("refuses on a draft (nothing sent yet)", async () => {
    queues["proposals"] = [
      { data: { ...sentProposalRow, status: "draft" }, error: null },
    ];
    await expect(
      resendSignLinksAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/sent proposal/);
  });
});

describe("createInvoiceFromProposalAction — deposit mode (SAL-049)", () => {
  const depositProposal = {
    id: "prop-1",
    team_id: TEAM,
    status: "accepted",
    customer_id: CUSTOMER,
    proposal_number: "PROP-2026-007",
    title: "Modernization",
    currency: "USD",
    payment_terms_days: 30,
    payment_terms_label: "Net 30",
    deposit_type: "percent",
    deposit_value: 50,
    accepted_total: 4950,
    deposit_invoice_id: null,
  };

  function seedDeposit(overrides: Record<string, unknown> = {}): void {
    queues["proposals"] = [
      { data: { ...depositProposal, ...overrides }, error: null },
      { data: [{ id: "prop-1" }], error: null }, // deposit-slot claim wins
    ];
    queues["proposal_acceptances"] = [
      {
        data: [
          {
            selected_line_item_ids: ["li-1", "li-2"],
            decision: "accepted",
            tax_rate: 0,
          },
        ],
        error: null,
      },
    ];
    queues["proposal_line_items"] = [{ data: CONVERT_ITEMS, error: null }];
    queues["team_settings"] = [
      { data: { invoice_prefix: "INV", invoice_next_num: 9, tax_rate: 0 }, error: null },
      { data: null, error: null }, // counter bump
    ];
    queues["invoices"] = [{ data: { id: "inv-dep" }, error: null }];
    queues["invoice_line_items"] = [{ data: null, error: null }];
  }

  it("bills 50% of the ACCEPTED total as one manual line and claims the slot", async () => {
    seedDeposit();
    await expect(
      createInvoiceFromProposalAction(
        formWith({ id: "prop-1", mode: "deposit" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /invoices/inv-dep");
    const [inv] = insertedRows("invoices");
    expect(inv).toMatchObject({ proposal_id: "prop-1", subtotal: 2475 });
    const [line] = insertedRows("invoice_line_items");
    expect(line).toMatchObject({ amount: 2475, proposal_line_item_id: null });
    expect(String(line!.description)).toMatch(/Deposit \(50%\)/);
    // Deposit NEVER claims item-level invoiced_at (that's the full bill's lock).
    const itemClaim = calls.find(
      (c) =>
        c.table === "proposal_line_items" &&
        c.ops.some((o) => o.method === "update"),
    );
    expect(itemClaim).toBeUndefined();
  });

  it("loses a concurrent deposit race: deletes its own invoice and refuses", async () => {
    seedDeposit();
    queues["proposals"] = [
      { data: depositProposal, error: null },
      { data: [], error: null }, // slot claim matched no row — lost the race
    ];
    queues["invoices"] = [
      { data: { id: "inv-dep" }, error: null },
      { data: null, error: null }, // our rollback delete
    ];
    await expect(
      createInvoiceFromProposalAction(
        formWith({ id: "prop-1", mode: "deposit" }),
      ),
    ).rejects.toThrow(/already been billed/);
    const del = calls.find(
      (c) =>
        c.table === "invoices" && c.ops.some((o) => o.method === "delete"),
    );
    expect(del).toBeDefined();
  });

  it("refuses when the deposit slot is already claimed", async () => {
    seedDeposit({ deposit_invoice_id: "inv-existing" });
    await expect(
      createInvoiceFromProposalAction(
        formWith({ id: "prop-1", mode: "deposit" }),
      ),
    ).rejects.toThrow(/already been billed/);
  });

  it("refuses when the proposal has no deposit term", async () => {
    seedDeposit({ deposit_type: "none", deposit_value: null });
    await expect(
      createInvoiceFromProposalAction(
        formWith({ id: "prop-1", mode: "deposit" }),
      ),
    ).rejects.toThrow(/no deposit term/);
  });
});

describe("createInvoiceFromProposalAction — deposit netting on the full bill", () => {
  it("nets a billed deposit out as a negative line (pre-tax)", async () => {
    queues["proposals"] = [
      {
        data: {
          id: "prop-1",
          team_id: TEAM,
          status: "accepted",
          customer_id: CUSTOMER,
          proposal_number: "PROP-2026-007",
          title: "Modernization",
          currency: "USD",
          payment_terms_days: 30,
          payment_terms_label: "Net 30",
          deposit_type: "percent",
          deposit_value: 50,
          accepted_total: 4950,
          deposit_invoice_id: "inv-dep",
        },
        error: null,
      },
    ];
    queues["proposal_acceptances"] = [
      {
        data: [
          {
            selected_line_item_ids: ["li-1", "li-2"],
            decision: "accepted",
            tax_rate: 0,
          },
        ],
        error: null,
      },
    ];
    queues["proposal_line_items"] = [
      { data: CONVERT_ITEMS, error: null },
      {
        data: [
          { id: "li-1", title: "Basic dependency upgrades", fixed_price: 950 },
          { id: "li-2", title: "Modernize underlying components", fixed_price: 4000 },
        ],
        error: null,
      },
    ];
    queues["team_settings"] = [
      { data: { invoice_prefix: "INV", invoice_next_num: 9, tax_rate: 0 }, error: null },
      { data: null, error: null },
    ];
    queues["invoices"] = [
      {
        data: { id: "inv-dep", invoice_number: "INV-008", subtotal: 2475, status: "sent" },
        error: null,
      }, // deposit lookup
      { data: { id: "inv-final" }, error: null }, // final insert
    ];
    queues["invoice_line_items"] = [{ data: null, error: null }];

    await expect(
      createInvoiceFromProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow("NEXT_REDIRECT /invoices/inv-final");

    const [finalInvoice] = insertedRows("invoices");
    // 950 + 4000 − 2475 = 2475: the client pays the remainder, never twice.
    expect(finalInvoice).toMatchObject({ subtotal: 2475 });
    const negLine = insertedRows("invoice_line_items").find(
      (l) => Number(l.amount) < 0,
    );
    expect(negLine).toMatchObject({ amount: -2475 });
    expect(String(negLine!.description)).toContain("INV-008");
  });
});
