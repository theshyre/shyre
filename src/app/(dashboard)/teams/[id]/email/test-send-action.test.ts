import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeUserId = "u-owner";

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
  validateTeamAccess: (teamId: string) => mockValidateTeamAccess(teamId),
}));

const mockDecryptForTeam = vi.fn();
vi.mock("@/lib/messaging/encryption", () => ({
  decryptForTeam: (...args: unknown[]) => mockDecryptForTeam(...args),
}));

const mockSend = vi.fn();
const mockSenderFor = vi.fn((..._args: unknown[]) => ({ send: mockSend }));
vi.mock("@/lib/messaging/providers", () => ({
  senderFor: (...args: unknown[]) => mockSenderFor(...args),
}));

const mockGetUserById = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: (id: string) => mockGetUserById(id) } },
  }),
}));

const state: {
  cfg: Record<string, unknown> | null;
  domain: { status: string } | null;
} = { cfg: null, domain: null };

function mockSupabase() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: table === "team_email_config" ? state.cfg : null,
              error: null,
            }),
          ilike: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: state.domain, error: null }),
          }),
        }),
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import { sendTestEmailAction } from "./test-send-action";

const goodCfg = {
  api_key_encrypted: "enc-blob",
  from_email: "billing@malcom.io",
  from_name: "Malcom IO",
  reply_to_email: "reply@malcom.io",
  signature: null,
};

function reset(): void {
  state.cfg = { ...goodCfg };
  state.domain = { status: "verified" };
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({
    userId: fakeUserId,
    role: "owner",
  });
  mockDecryptForTeam.mockReset();
  mockDecryptForTeam.mockResolvedValue("re_live_key");
  mockSend.mockReset();
  mockSend.mockResolvedValue(undefined);
  mockSenderFor.mockClear();
  mockGetUserById.mockReset();
  mockGetUserById.mockResolvedValue({
    data: { user: { email: "marcus@malcom.io" } },
    error: null,
  });
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("sendTestEmailAction", () => {
  beforeEach(reset);

  it("sends a test email to the caller's own mailbox on the happy path", async () => {
    await sendTestEmailAction(fd({ team_id: "t-1" }));
    expect(mockSenderFor).toHaveBeenCalledWith("resend", "re_live_key");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const msg = mockSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(msg).toMatchObject({
      from: { email: "billing@malcom.io", name: "Malcom IO" },
      to: [{ email: "marcus@malcom.io" }],
      replyTo: "reply@malcom.io",
      tags: { shyre_team_id: "t-1", shyre_kind: "test" },
    });
    expect(msg.subject).toContain("billing@malcom.io");
    expect(String(msg.idempotencyKey)).toMatch(/^test:t-1:/);
  });

  it("requires team_id", async () => {
    await expect(sendTestEmailAction(fd({}))).rejects.toThrow(
      /team_id is required/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("denies plain members", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /owners and admins/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("asks the user to save an API key first when config is missing", async () => {
    state.cfg = null;
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /Save an API key first/,
    );
  });

  it("asks for a From address when unset", async () => {
    state.cfg = { ...goodCfg, from_email: null };
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /Set a From address/,
    );
  });

  it("surfaces a decryption failure as a re-paste instruction (key rotation path)", async () => {
    mockDecryptForTeam.mockRejectedValue(new Error("bad key version"));
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /Re-paste your Resend API key/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("treats a null decrypt result the same way", async () => {
    mockDecryptForTeam.mockResolvedValue(null);
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /Re-paste your Resend API key/,
    );
  });

  it("refuses to send from an unverified domain", async () => {
    state.domain = { status: "pending" };
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /not verified yet/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("refuses when no domain row exists at all", async () => {
    state.domain = null;
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /not verified yet/,
    );
  });

  it("errors when the caller's email cannot be resolved", async () => {
    mockGetUserById.mockResolvedValue({ data: null, error: { message: "x" } });
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /Could not resolve your email/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("refuses a role-address recipient (validateRecipient gauntlet)", async () => {
    mockGetUserById.mockResolvedValue({
      data: { user: { email: "noreply@malcom.io" } },
      error: null,
    });
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /is not deliverable/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("omits the from name when unset and propagates provider failures", async () => {
    state.cfg = { ...goodCfg, from_name: null, reply_to_email: null };
    mockSend.mockRejectedValue(new Error("resend 500"));
    await expect(sendTestEmailAction(fd({ team_id: "t-1" }))).rejects.toThrow(
      /resend 500/,
    );
    const msg = mockSend.mock.calls[0]?.[0] as {
      from: { name?: string };
      replyTo?: string;
    };
    expect(msg.from.name).toBeUndefined();
    expect(msg.replyTo).toBeUndefined();
  });
});
