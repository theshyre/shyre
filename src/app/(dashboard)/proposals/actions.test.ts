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
  order: (col: string, opts?: unknown) => Builder;
  limit: (n: number) => Builder;
  insert: (rows: unknown) => Builder;
  update: (patch: unknown) => Builder;
  delete: () => Builder;
  single: () => Promise<Result>;
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

  it("refuses without a signer contact", async () => {
    queues["proposals"] = [
      { data: { ...draftProposal, signer_contact_id: null }, error: null },
    ];
    await expect(
      sendProposalAction(formWith({ id: "prop-1" })),
    ).rejects.toThrow(/Pick a signer contact/);
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
