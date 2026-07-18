import { describe, it, expect, vi, beforeEach } from "vitest";

// Same harness as send-invoice.test.ts: the pipeline modules (outbox,
// provider registry, quota, encryption) are stubbed so these tests pin
// sendProposalEmail's own orchestration — validation order, header
// sanitation, quota refusal, and the returned ids — not the pipeline
// internals (each has its own test file).
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

import { sendProposalEmail, type SendProposalEmailInput } from "./send-proposal";

function baseInput(
  overrides: Partial<SendProposalEmailInput> = {},
): SendProposalEmailInput {
  return {
    teamId: "team-1",
    userId: "user-1",
    proposalId: "prop-1",
    kind: "proposal",
    toEmail: "jordan@eyereg.example",
    subject: "Proposal PROP-2026-007: Modernization",
    bodyHtml: "<p>Review & sign</p>",
    bodyText: "Review & sign",
    ...overrides,
  };
}

const fakeSupabase = {} as Parameters<typeof sendProposalEmail>[0];

describe("sendProposalEmail", () => {
  beforeEach(() => {
    decryptForTeamMock.mockReset();
    loadTeamConfigMock.mockReset();
    assertFromDomainAllowedMock.mockReset();
    enqueueMock.mockReset();
    drainMock.mockReset();
    senderForMock.mockReset();
    consumeDailyQuotaMock.mockReset();

    // Happy-path scaffolding; individual tests override the failure
    // they exercise.
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
    const result = await sendProposalEmail(fakeSupabase, baseInput());
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

    // The outbox row carries the proposal linkage + recipient list.
    const enqueued = enqueueMock.mock.calls[0]![0] as {
      relatedKind: string;
      relatedId: string;
      toEmails: string[];
      idempotencyKey: string;
    };
    expect(enqueued.relatedKind).toBe("proposal");
    expect(enqueued.relatedId).toBe("prop-1");
    expect(enqueued.toEmails).toEqual(["jordan@eyereg.example"]);
    // Key shape: {kind}:{proposal}:{YYYY-MM-DD}:{uuid}.
    expect(enqueued.idempotencyKey).toMatch(
      /^proposal:prop-1:\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/,
    );
  });

  it("rejects role addresses (noreply@…) before any quota or outbox write", async () => {
    await expect(
      sendProposalEmail(
        fakeSupabase,
        baseInput({ toEmail: "noreply@acme.test" }),
      ),
    ).rejects.toThrow(/role address/);
    expect(consumeDailyQuotaMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed recipient", async () => {
    await expect(
      sendProposalEmail(fakeSupabase, baseInput({ toEmail: "not-an-email" })),
    ).rejects.toThrow(/not a valid email/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("sanitizes CRLF/tab out of the subject header (no header injection)", async () => {
    await sendProposalEmail(
      fakeSupabase,
      baseInput({ subject: "Proposal\r\nBcc: attacker@evil.test\tnow" }),
    );
    // Newlines/tabs collapse to single spaces — the injected header
    // line can never split out of the Subject field.
    const enqueued = enqueueMock.mock.calls[0]![0] as { subject: string };
    expect(enqueued.subject).toBe("Proposal Bcc: attacker@evil.test now");
    const message = drainMock.mock.calls[0]![1] as { subject: string };
    expect(message.subject).toBe("Proposal Bcc: attacker@evil.test now");
  });

  it("rejects a subject that is empty after sanitization", async () => {
    await expect(
      sendProposalEmail(fakeSupabase, baseInput({ subject: " \r\n " })),
    ).rejects.toThrow(/Subject is empty/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("propagates the daily-cap refusal with the cap in the message; nothing is enqueued", async () => {
    consumeDailyQuotaMock.mockResolvedValueOnce({
      allowed: false,
      reason: "cap_reached",
      remaining: 0,
      cap: 50,
    });
    await expect(sendProposalEmail(fakeSupabase, baseInput())).rejects.toThrow(
      /Daily send cap reached \(50\/day\)/,
    );
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("propagates a quota no_config refusal as a configuration error", async () => {
    consumeDailyQuotaMock.mockResolvedValueOnce({
      allowed: false,
      reason: "no_config",
      remaining: 0,
      cap: 0,
    });
    await expect(sendProposalEmail(fakeSupabase, baseInput())).rejects.toThrow(
      /Email is not configured/,
    );
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("rejects when there is no team email config at all", async () => {
    loadTeamConfigMock.mockResolvedValueOnce(null);
    await expect(sendProposalEmail(fakeSupabase, baseInput())).rejects.toThrow(
      /Email is not configured/,
    );
  });

  it("rejects when the stored API key cannot be decrypted", async () => {
    decryptForTeamMock.mockResolvedValueOnce(null);
    await expect(sendProposalEmail(fakeSupabase, baseInput())).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  it("throws when drain reports no provider result (send failed after enqueue)", async () => {
    drainMock.mockResolvedValueOnce({ row: { id: "outbox-1" }, result: null });
    await expect(sendProposalEmail(fakeSupabase, baseInput())).rejects.toThrow(
      /Send failed for outbox outbox-1/,
    );
  });
});
