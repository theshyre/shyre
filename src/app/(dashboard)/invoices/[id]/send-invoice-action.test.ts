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
  validateTeamAccess: (...args: unknown[]) =>
    mockValidateTeamAccess(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const mockSendInvoice = vi.fn();
vi.mock("@/lib/messaging/send-invoice", () => ({
  sendInvoice: (...args: unknown[]) => mockSendInvoice(...args),
}));

vi.mock("@/lib/messaging/render", () => ({
  // Simple validator: rejects empty / no-@ strings, otherwise null.
  validateRecipient: (email: string) => {
    if (!email || !email.includes("@")) return "invalid";
    return null;
  },
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockGetUserById = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: (...args: unknown[]) => mockGetUserById(...args),
      },
    },
  }),
}));

interface InvoiceRow {
  id: string;
  team_id: string;
  customer_id: string;
  invoice_number: string;
  status: string;
  customers: { name: string } | null;
}

const state: {
  invoice: InvoiceRow | null;
  updates: { table: string; patch: unknown; where: Record<string, string> }[];
} = {
  invoice: null,
  updates: [],
};

function mockSupabase() {
  return {
    from: (table: string) => {
      if (table !== "invoices") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: state.invoice, error: null }),
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
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import { sendInvoiceMessageAction } from "./send-invoice-action";

function reset(): void {
  state.invoice = null;
  state.updates = [];
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
  mockSendInvoice.mockReset();
  mockGetUserById.mockReset();
  mockLogError.mockReset();
}

function makePdfFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "invoice.pdf", {
    type: "application/pdf",
  });
}

function fd(entries: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v instanceof File) f.set(k, v);
    else f.set(k, v);
  }
  return f;
}

const VALID_INVOICE: InvoiceRow = {
  id: "inv-1",
  team_id: "team-1",
  customer_id: "cust-1",
  invoice_number: "INV-0042",
  status: "draft",
  customers: { name: "Acme" },
};

const VALID_FORM = (): Record<string, string | File> => ({
  invoice_id: "inv-1",
  subject: "Your invoice",
  body_text: "See attached.",
  body_html: "<p>See attached.</p>",
  to_email: "ap@acme.test",
  pdf: makePdfFile(),
});

function seedHappy(): void {
  state.invoice = { ...VALID_INVOICE };
  mockValidateTeamAccess.mockResolvedValue({
    userId: fakeUserId,
    role: "owner",
  });
  mockSendInvoice.mockResolvedValue({
    providerMessageId: "prov-1",
    outboxId: "outbox-1",
  });
}

describe("sendInvoiceMessageAction", () => {
  beforeEach(reset);

  it("happy path: dispatches the message and flips status draft → sent", async () => {
    seedHappy();
    await sendInvoiceMessageAction(fd(VALID_FORM()));

    expect(mockSendInvoice).toHaveBeenCalledTimes(1);
    const args = mockSendInvoice.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(args.invoiceId).toBe("inv-1");
    expect(args.toEmails).toEqual(["ap@acme.test"]);
    expect(args.kind).toBe("invoice");

    // Status flip + sent_at recorded.
    expect(state.updates).toHaveLength(1);
    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.status).toBe("sent");
    expect(patch.sent_at).toBeTypeOf("string");
    expect(patch.sent_to_email).toBe("ap@acme.test");
    expect(patch.sent_to_name).toBe("Acme");
  });

  it("re-sends do NOT overwrite sent_at (only first send anchors the timestamp)", async () => {
    state.invoice = { ...VALID_INVOICE, status: "sent" };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    mockSendInvoice.mockResolvedValue({
      providerMessageId: "prov-2",
      outboxId: "outbox-2",
    });

    await sendInvoiceMessageAction(fd(VALID_FORM()));

    const patch = state.updates[0]?.patch as Record<string, unknown>;
    expect(patch.status).toBeUndefined();
    expect(patch.sent_at).toBeUndefined();
    // sent_to_email + sent_to_name DO update on every resend.
    expect(patch.sent_to_email).toBe("ap@acme.test");
  });

  it("refuses to send a void invoice (no message dispatched)", async () => {
    state.invoice = { ...VALID_INVOICE, status: "void" };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });

    await expect(
      sendInvoiceMessageAction(fd(VALID_FORM())),
    ).rejects.toThrow(/void/i);
    expect(mockSendInvoice).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
  });

  it("refuses a plain member (only owner|admin can send)", async () => {
    state.invoice = { ...VALID_INVOICE };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });

    await expect(
      sendInvoiceMessageAction(fd(VALID_FORM())),
    ).rejects.toThrow(/owner.*admin/i);
    expect(mockSendInvoice).not.toHaveBeenCalled();
  });

  it("admins can send (role='admin' passes the gate)", async () => {
    state.invoice = { ...VALID_INVOICE };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    mockSendInvoice.mockResolvedValue({
      providerMessageId: "prov-1",
      outboxId: "outbox-1",
    });

    await sendInvoiceMessageAction(fd(VALID_FORM()));
    expect(mockSendInvoice).toHaveBeenCalledTimes(1);
  });

  it("returns 'not found' before role check when invoice id misses", async () => {
    state.invoice = null;
    await expect(
      sendInvoiceMessageAction(fd(VALID_FORM())),
    ).rejects.toThrow(/not found/i);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
  });

  it("rejects without an invoice_id (no DB read)", async () => {
    const f = fd(VALID_FORM());
    f.delete("invoice_id");
    await expect(sendInvoiceMessageAction(f)).rejects.toThrow(
      /invoice_id is required/,
    );
  });

  it("rejects when no PDF file is attached", async () => {
    seedHappy();
    const f = fd(VALID_FORM());
    f.delete("pdf");
    await expect(sendInvoiceMessageAction(f)).rejects.toThrow(
      /PDF attachment/i,
    );
    expect(mockSendInvoice).not.toHaveBeenCalled();
  });

  it("dedupes To addresses and case-collapses", async () => {
    seedHappy();
    await sendInvoiceMessageAction(
      fd({
        ...VALID_FORM(),
        to_email: "ap@acme.test, AP@ACME.test, ap@acme.test",
      }),
    );

    const args = mockSendInvoice.mock.calls[0]?.[1] as {
      toEmails: string[];
    };
    expect(args.toEmails).toEqual(["ap@acme.test"]);
  });

  it("drops Cc addresses that already appear in To (no doubled deliveries)", async () => {
    seedHappy();
    await sendInvoiceMessageAction(
      fd({
        ...VALID_FORM(),
        to_email: "ap@acme.test, cfo@acme.test",
        cc_emails: "ap@acme.test, AP@acme.test, ops@acme.test",
      }),
    );

    const args = mockSendInvoice.mock.calls[0]?.[1] as {
      ccEmails: string[];
    };
    // ap@ already in To, dropped. AP@ same address, dropped. ops@ kept.
    expect(args.ccEmails).toEqual(["ops@acme.test"]);
  });

  it("auto-CCs the sender's own email when send_copy_to_me=on", async () => {
    seedHappy();
    mockGetUserById.mockResolvedValue({
      data: { user: { email: "marcus@malcom.io" } },
    });

    await sendInvoiceMessageAction(
      fd({ ...VALID_FORM(), send_copy_to_me: "on" }),
    );

    const args = mockSendInvoice.mock.calls[0]?.[1] as {
      ccEmails?: string[];
    };
    expect(args.ccEmails).toContain("marcus@malcom.io");
  });

  it("does NOT auto-CC the sender if their email is already in To", async () => {
    seedHappy();
    mockGetUserById.mockResolvedValue({
      data: { user: { email: "marcus@malcom.io" } },
    });

    await sendInvoiceMessageAction(
      fd({
        ...VALID_FORM(),
        to_email: "ap@acme.test, marcus@malcom.io",
        send_copy_to_me: "on",
      }),
    );

    const args = mockSendInvoice.mock.calls[0]?.[1] as {
      ccEmails?: string[];
    };
    // Either undefined (no Cc) or doesn't contain the duplicate.
    if (args.ccEmails) {
      expect(args.ccEmails).not.toContain("marcus@malcom.io");
    }
  });

  it("does NOT auto-CC the sender if their email is already in Cc", async () => {
    seedHappy();
    mockGetUserById.mockResolvedValue({
      data: { user: { email: "marcus@malcom.io" } },
    });

    await sendInvoiceMessageAction(
      fd({
        ...VALID_FORM(),
        cc_emails: "marcus@malcom.io",
        send_copy_to_me: "on",
      }),
    );

    const args = mockSendInvoice.mock.calls[0]?.[1] as {
      ccEmails: string[];
    };
    // Should appear once, not twice.
    const occurrences = args.ccEmails.filter(
      (e) => e.toLowerCase() === "marcus@malcom.io",
    );
    expect(occurrences).toHaveLength(1);
  });

  it("logs and rethrows when sendInvoice fails (no status flip on failure)", async () => {
    state.invoice = { ...VALID_INVOICE };
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "owner",
    });
    mockSendInvoice.mockRejectedValue(new Error("Resend timeout"));

    await expect(
      sendInvoiceMessageAction(fd(VALID_FORM())),
    ).rejects.toThrow(/Resend timeout/);

    // Failure path logs (logError called once with action context)…
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const ctx = mockLogError.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(ctx.action).toBe("sendInvoiceMessageAction");
    expect(ctx.teamId).toBe("team-1");

    // …and the invoice status is NOT flipped to sent (the activity
    // log + AR aging report depend on this — a failed send must
    // not look like a successful one).
    expect(state.updates).toEqual([]);
  });
});
