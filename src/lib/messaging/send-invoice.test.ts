import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  decryptForTeamMock,
  loadTeamConfigMock,
  assertFromDomainAllowedMock,
  enqueueMock,
  drainMock,
  senderForMock,
  consumeDailyQuotaMock,
} = vi.hoisted(() => ({
  decryptForTeamMock: vi.fn(),
  loadTeamConfigMock: vi.fn(),
  assertFromDomainAllowedMock: vi.fn(),
  enqueueMock: vi.fn(),
  drainMock: vi.fn(),
  senderForMock: vi.fn(),
  consumeDailyQuotaMock: vi.fn(),
}));

vi.mock("./encryption", () => ({
  decryptForTeam: (...args: unknown[]) =>
    decryptForTeamMock(...(args as Parameters<typeof decryptForTeamMock>)),
}));

vi.mock("./outbox", () => ({
  loadTeamConfig: (...args: unknown[]) =>
    loadTeamConfigMock(...(args as Parameters<typeof loadTeamConfigMock>)),
  assertFromDomainAllowed: (...args: unknown[]) =>
    assertFromDomainAllowedMock(
      ...(args as Parameters<typeof assertFromDomainAllowedMock>),
    ),
  enqueue: (...args: unknown[]) =>
    enqueueMock(...(args as Parameters<typeof enqueueMock>)),
  drain: (...args: unknown[]) =>
    drainMock(...(args as Parameters<typeof drainMock>)),
}));

vi.mock("./providers", () => ({
  senderFor: (...args: unknown[]) =>
    senderForMock(...(args as Parameters<typeof senderForMock>)),
}));

vi.mock("./rate-limit", () => ({
  consumeDailyQuota: (...args: unknown[]) =>
    consumeDailyQuotaMock(...(args as Parameters<typeof consumeDailyQuotaMock>)),
}));

import { sendInvoice, type SendInvoiceInput } from "./send-invoice";

function baseInput(overrides: Partial<SendInvoiceInput> = {}): SendInvoiceInput {
  return {
    teamId: "team-1",
    userId: "user-1",
    invoiceId: "inv-1",
    subject: "Invoice INV-001",
    bodyHtml: "<p>Hello</p>",
    bodyText: "Hello",
    toEmails: ["bill@acme.test"],
    pdfBytes: Buffer.from("%PDF-1.7"),
    pdfFilename: "invoice.pdf",
    kind: "invoice",
    ...overrides,
  };
}

const fakeSupabase = {} as Parameters<typeof sendInvoice>[0];

describe("sendInvoice", () => {
  beforeEach(() => {
    decryptForTeamMock.mockReset();
    loadTeamConfigMock.mockReset();
    assertFromDomainAllowedMock.mockReset();
    enqueueMock.mockReset();
    drainMock.mockReset();
    senderForMock.mockReset();
    consumeDailyQuotaMock.mockReset();

    // Default happy-path scaffolding — individual tests override per
    // failure mode they want to exercise.
    loadTeamConfigMock.mockResolvedValue({
      apiKeyCipher: "<cipher>",
      fromEmail: "billing@marcus.test",
      fromName: "Marcus",
      replyToEmail: null,
    });
    decryptForTeamMock.mockResolvedValue("api-key");
    assertFromDomainAllowedMock.mockResolvedValue(undefined);
    consumeDailyQuotaMock.mockResolvedValue({
      allowed: true,
      cap: 100,
      remaining: 99,
    });
    enqueueMock.mockResolvedValue({ id: "outbox-1" });
    senderForMock.mockReturnValue({ kind: "resend-stub" });
    drainMock.mockResolvedValue({
      row: { id: "outbox-1" },
      result: { providerMessageId: "rmsg-1" },
    });
  });

  it("returns outboxId + providerMessageId on the happy path", async () => {
    const result = await sendInvoice(fakeSupabase, baseInput());
    expect(result).toEqual({
      outboxId: "outbox-1",
      providerMessageId: "rmsg-1",
    });
    expect(loadTeamConfigMock).toHaveBeenCalledWith(fakeSupabase, "team-1");
    expect(decryptForTeamMock).toHaveBeenCalledWith(
      fakeSupabase,
      "team-1",
      "<cipher>",
    );
    expect(senderForMock).toHaveBeenCalledWith("resend", "api-key");
  });

  it("passes a PDF attachment with the right content-type to enqueue", async () => {
    await sendInvoice(fakeSupabase, baseInput());
    const call = enqueueMock.mock.calls[0]![0];
    expect(call.attachments[0].contentType).toBe("application/pdf");
    expect(call.attachments[0].filename).toBe("invoice.pdf");
    expect(Buffer.isBuffer(call.attachments[0].content)).toBe(true);
  });

  it("constructs an idempotency key shape {kind}:{invoice}:{YYYY-MM-DD}:{uuid}", async () => {
    await sendInvoice(fakeSupabase, baseInput());
    const call = enqueueMock.mock.calls[0]![0];
    expect(call.idempotencyKey).toMatch(
      /^invoice:inv-1:\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/,
    );
  });

  it("rejects when there is no team_email_config row", async () => {
    loadTeamConfigMock.mockResolvedValueOnce(null);
    await expect(sendInvoice(fakeSupabase, baseInput())).rejects.toThrow(
      /Email is not configured/,
    );
  });

  it("rejects when the team config lacks an apiKeyCipher", async () => {
    loadTeamConfigMock.mockResolvedValueOnce({
      apiKeyCipher: null,
      fromEmail: "x@y.test",
      fromName: null,
      replyToEmail: null,
    });
    await expect(sendInvoice(fakeSupabase, baseInput())).rejects.toThrow(
      /API key is missing/,
    );
  });

  it("rejects when decryption returns null (key rotated / wrong DEK)", async () => {
    decryptForTeamMock.mockResolvedValueOnce(null);
    await expect(sendInvoice(fakeSupabase, baseInput())).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  it("rejects when from-email is empty after override + config fallback", async () => {
    loadTeamConfigMock.mockResolvedValueOnce({
      apiKeyCipher: "<cipher>",
      fromEmail: "",
      fromName: null,
      replyToEmail: null,
    });
    await expect(
      sendInvoice(fakeSupabase, baseInput({ fromEmailOverride: "" })),
    ).rejects.toThrow(/From address is not set/);
  });

  it("rejects when toEmails is empty", async () => {
    await expect(
      sendInvoice(fakeSupabase, baseInput({ toEmails: [] })),
    ).rejects.toThrow(/At least one To: recipient/);
  });

  it("rejects when a To: address is malformed", async () => {
    await expect(
      sendInvoice(fakeSupabase, baseInput({ toEmails: ["not-an-email"] })),
    ).rejects.toThrow(/not a valid email/);
  });

  it("rejects when a To: address is a role address (noreply / postmaster / bounces)", async () => {
    await expect(
      sendInvoice(fakeSupabase, baseInput({ toEmails: ["noreply@acme.test"] })),
    ).rejects.toThrow(/role address/);
  });

  it("rejects when a CC: address is malformed", async () => {
    await expect(
      sendInvoice(
        fakeSupabase,
        baseInput({ ccEmails: ["@@notvalid"] }),
      ),
    ).rejects.toThrow(/CC.*not a valid recipient/);
  });

  it("rejects when the subject is empty after sanitization", async () => {
    await expect(
      sendInvoice(fakeSupabase, baseInput({ subject: "" })),
    ).rejects.toThrow(/Subject is empty/);
  });

  it("rejects when assertFromDomainAllowed throws (from-domain mismatch)", async () => {
    assertFromDomainAllowedMock.mockRejectedValueOnce(
      new Error("From domain not verified for this team."),
    );
    await expect(sendInvoice(fakeSupabase, baseInput())).rejects.toThrow(
      /not verified/,
    );
  });

  it("rejects when the daily-cap consumer returns no_config", async () => {
    consumeDailyQuotaMock.mockResolvedValueOnce({
      allowed: false,
      reason: "no_config",
      cap: 0,
    });
    await expect(sendInvoice(fakeSupabase, baseInput())).rejects.toThrow(
      /Email is not configured/,
    );
  });

  it("rejects when the daily cap is exhausted", async () => {
    consumeDailyQuotaMock.mockResolvedValueOnce({
      allowed: false,
      reason: "exhausted",
      cap: 100,
    });
    await expect(sendInvoice(fakeSupabase, baseInput())).rejects.toThrow(
      /Daily send cap reached \(100\/day\)/,
    );
  });

  it("counts every envelope (To + Cc + Bcc) against the cap", async () => {
    await sendInvoice(
      fakeSupabase,
      baseInput({
        toEmails: ["bill@acme.test", "cfo@acme.test"],
        ccEmails: ["accounting@acme.test"],
        bccEmails: ["archive@us.test"],
      }),
    );
    expect(consumeDailyQuotaMock).toHaveBeenCalledWith(
      fakeSupabase,
      "team-1",
      4,
    );
  });

  it("rejects when the drain result is missing (provider returned nothing)", async () => {
    drainMock.mockResolvedValueOnce({ row: { id: "outbox-1" }, result: null });
    await expect(sendInvoice(fakeSupabase, baseInput())).rejects.toThrow(
      /Send failed for outbox outbox-1/,
    );
  });

  it("prefers fromEmailOverride over team config when set", async () => {
    await sendInvoice(
      fakeSupabase,
      baseInput({ fromEmailOverride: "override@marcus.test" }),
    );
    const call = enqueueMock.mock.calls[0]![0];
    expect(call.fromEmail).toBe("override@marcus.test");
  });

  it("prefers fromNameOverride over team config when set", async () => {
    await sendInvoice(
      fakeSupabase,
      baseInput({ fromNameOverride: "Custom Sender" }),
    );
    const call = enqueueMock.mock.calls[0]![0];
    expect(call.fromName).toBe("Custom Sender");
  });

  it("prefers replyToEmailOverride over team config when set", async () => {
    await sendInvoice(
      fakeSupabase,
      baseInput({ replyToEmailOverride: "reply@marcus.test" }),
    );
    const call = enqueueMock.mock.calls[0]![0];
    expect(call.replyToEmail).toBe("reply@marcus.test");
  });

  it("propagates tags to the outbound message (team_id, invoice_id, kind)", async () => {
    await sendInvoice(fakeSupabase, baseInput());
    const drainCall = drainMock.mock.calls[0]!;
    const message = drainCall[1];
    expect(message.tags).toEqual({
      shyre_team_id: "team-1",
      shyre_invoice_id: "inv-1",
      shyre_kind: "invoice",
    });
  });

  it("uses the same idempotency key on enqueue + drain message", async () => {
    await sendInvoice(fakeSupabase, baseInput());
    const enqueueCall = enqueueMock.mock.calls[0]![0];
    const drainCall = drainMock.mock.calls[0]!;
    expect(drainCall[1].idempotencyKey).toBe(enqueueCall.idempotencyKey);
  });
});
