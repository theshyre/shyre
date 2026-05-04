import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Outbox unit tests.
 *
 * The integration with Supabase is mocked at the module boundary
 * (`@/lib/supabase/admin`). What we exercise here is the
 * classify-error-and-flip-status state machine + the idempotency-
 * key collision return-existing path. A separate integration test
 * (PR2.10) proves the BYTEA round-trip through real PostgREST;
 * this file is the pure-logic floor.
 */

const updateMock = vi.fn();
const insertSelectSingleMock = vi.fn();
const insertCallMock = vi.fn();
const selectMaybeSingleMock = vi.fn();
const selectSingleMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      // enqueue calls `.insert(...).select("*").single()`. Mirror
      // the chain: insert returns an object whose
      // `.select().single()` resolves with the configured result.
      insert: (...args: unknown[]) => {
        insertCallMock(...args);
        return {
          select: () => ({
            single: () => insertSelectSingleMock(),
          }),
        };
      },
      update: (patch: unknown) => ({
        eq: (..._args: unknown[]) => {
          const promise = updateMock(patch);
          // The drain success path chains .select("*").single() on
          // the update — return a thenable that also exposes those.
          return Object.assign(Promise.resolve(promise), {
            select: () => ({
              single: () => selectSingleMock(),
            }),
          });
        },
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => selectMaybeSingleMock(),
          single: () => selectSingleMock(),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import { drain, enqueue, type OutboxRow } from "./outbox";

function row(): OutboxRow {
  return {
    id: "outbox-1",
    team_id: "team-1",
    user_id: "user-1",
    related_kind: "invoice",
    related_id: "inv-1",
    provider: "resend",
    provider_message_id: null,
    from_email: "from@example.com",
    from_name: null,
    reply_to_email: null,
    to_email: "to@example.com",
    to_emails: ["to@example.com"],
    cc_emails: null,
    bcc_emails: null,
    subject: "Hi",
    body_html: null,
    body_text: null,
    attachments: null,
    attachment_pdf_sha256: null,
    idempotency_key: "k-1",
    status: "queued",
    attempt_count: 0,
    next_attempt_at: null,
    error_message: null,
    bounce_reason: null,
    bounce_type: null,
    sent_at: null,
    delivered_at: null,
    last_event_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const fakeMessage = {
  from: { email: "from@example.com" },
  to: [{ email: "to@example.com" }],
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
  attachments: [],
  idempotencyKey: "k-1",
};

beforeEach(() => {
  updateMock.mockReset();
  insertCallMock.mockReset();
  insertSelectSingleMock.mockReset();
  selectMaybeSingleMock.mockReset();
  selectSingleMock.mockReset();
});

describe("drain — state machine", () => {
  it("flips queued → sending → sent on provider success", async () => {
    selectSingleMock.mockResolvedValue({
      data: { ...row(), status: "sent" },
      error: null,
    });
    const sender = {
      send: vi.fn().mockResolvedValue({
        providerMessageId: "msg-123",
        provider: "resend",
        acceptedAt: new Date(),
      }),
      ensureDomain: vi.fn(),
      refreshDomain: vi.fn(),
    };
    const { result } = await drain(row(), fakeMessage, sender);
    expect(result?.providerMessageId).toBe("msg-123");
    // First UPDATE flipped to "sending" with attempt_count
    // incremented; second UPDATE wrote "sent" + provider id.
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock.mock.calls[0]![0]).toMatchObject({
      status: "sending",
      attempt_count: 1,
    });
    expect(updateMock.mock.calls[1]![0]).toMatchObject({
      status: "sent",
      provider_message_id: "msg-123",
    });
  });

  it("flips to failed_permanent on provider 4xx", async () => {
    const sender = {
      send: vi.fn().mockRejectedValue(
        Object.assign(new Error("bad request"), { status: 422 }),
      ),
      ensureDomain: vi.fn(),
      refreshDomain: vi.fn(),
    };
    await expect(drain(row(), fakeMessage, sender)).rejects.toThrow();
    // Two updates: queued→sending, then sending→failed_permanent.
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock.mock.calls[1]![0]).toMatchObject({
      status: "failed_permanent",
    });
  });

  it("flips to failed_retryable on provider 5xx", async () => {
    const sender = {
      send: vi.fn().mockRejectedValue(
        Object.assign(new Error("server error"), { status: 503 }),
      ),
      ensureDomain: vi.fn(),
      refreshDomain: vi.fn(),
    };
    await expect(drain(row(), fakeMessage, sender)).rejects.toThrow();
    expect(updateMock.mock.calls[1]![0]).toMatchObject({
      status: "failed_retryable",
    });
  });

  it("flips to failed_retryable on a network error (no status)", async () => {
    const sender = {
      send: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      ensureDomain: vi.fn(),
      refreshDomain: vi.fn(),
    };
    await expect(drain(row(), fakeMessage, sender)).rejects.toThrow();
    expect(updateMock.mock.calls[1]![0]).toMatchObject({
      status: "failed_retryable",
    });
  });

  it("treats 429 as retryable (not permanent)", async () => {
    const sender = {
      send: vi.fn().mockRejectedValue(
        Object.assign(new Error("rate limited"), { status: 429 }),
      ),
      ensureDomain: vi.fn(),
      refreshDomain: vi.fn(),
    };
    await expect(drain(row(), fakeMessage, sender)).rejects.toThrow();
    expect(updateMock.mock.calls[1]![0]).toMatchObject({
      status: "failed_retryable",
    });
  });

  it("preserves the error message on failure for forensics", async () => {
    const sender = {
      send: vi.fn().mockRejectedValue(
        Object.assign(new Error("invalid api key"), { status: 401 }),
      ),
      ensureDomain: vi.fn(),
      refreshDomain: vi.fn(),
    };
    await expect(drain(row(), fakeMessage, sender)).rejects.toThrow();
    expect(updateMock.mock.calls[1]![0]).toMatchObject({
      status: "failed_permanent",
      error_message: "invalid api key",
    });
  });
});

describe("enqueue — idempotency", () => {
  it("returns the existing row on idempotency_key collision (23505)", async () => {
    // First insert returns 23505; lookup returns the existing row.
    const existing = { ...row(), id: "outbox-existing" };
    insertSelectSingleMock.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    selectSingleMock.mockResolvedValue({ data: existing, error: null });
    const result = await enqueue({
      teamId: "team-1",
      userId: "user-1",
      relatedKind: "invoice",
      relatedId: "inv-1",
      fromEmail: "from@example.com",
      fromName: null,
      replyToEmail: null,
      toEmails: ["to@example.com"],
      subject: "Hi",
      bodyHtml: "<p>Hi</p>",
      bodyText: "Hi",
      idempotencyKey: "k-existing",
    });
    expect(result.id).toBe("outbox-existing");
  });

  it("throws when insert fails for any other reason", async () => {
    insertSelectSingleMock.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: "table missing" },
    });
    await expect(
      enqueue({
        teamId: "team-1",
        userId: "user-1",
        relatedKind: "invoice",
        relatedId: "inv-1",
        fromEmail: "from@example.com",
        fromName: null,
        replyToEmail: null,
        toEmails: ["to@example.com"],
        subject: "Hi",
        bodyHtml: "<p>Hi</p>",
        bodyText: "Hi",
        idempotencyKey: "k-fail",
      }),
    ).rejects.toThrow(/table missing/);
  });
});
