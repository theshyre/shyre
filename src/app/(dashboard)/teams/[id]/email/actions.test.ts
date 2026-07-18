import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock runSafeAction to strip the auth boundary (covered by
// safe-action.test.ts). The pure helpers (sanitizeHeaderValue,
// validateRecipient, defaultExpiryYear) stay REAL — their behavior is
// part of this action's contract (header injection, role addresses,
// default rotate-by dates).
const fakeUserId = "u-mailer";
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
  validateTeamAccess: (...args: unknown[]) => mockValidateTeamAccess(...args),
  isTeamAdmin: (role: string) => role === "owner" || role === "admin",
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

// Envelope encryption boundary — mocked; encryption.test.ts covers the
// real crypto. bytesForPg tags the cipher so tests can assert the
// PG-ready value flowed into the patch.
const mockEncryptForTeam = vi.fn();
const mockDecryptForTeam = vi.fn();
vi.mock("@/lib/messaging/encryption", () => ({
  encryptForTeam: (...args: unknown[]) => mockEncryptForTeam(...args),
  decryptForTeam: (...args: unknown[]) => mockDecryptForTeam(...args),
  bytesForPg: (cipher: unknown) => `pg(${String(cipher)})`,
}));

// Resend boundary — mocked at senderFor.
const mockEnsureDomain = vi.fn();
const mockRefreshDomain = vi.fn();
const mockSenderFor = vi.fn((..._args: unknown[]) => ({
  ensureDomain: mockEnsureDomain,
  refreshDomain: mockRefreshDomain,
}));
vi.mock("@/lib/messaging/providers", () => ({
  senderFor: (...args: unknown[]) => mockSenderFor(...args),
}));

interface SupaError {
  message: string;
  code?: string;
}

const state: {
  upserts: { table: string; row: unknown; opts?: unknown }[];
  upsertError: SupaError | null;
  emailCfg: { api_key_encrypted: string } | null;
  domainRow: { provider_domain_id: string | null; domain: string } | null;
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  rpcError: SupaError | null;
} = {
  upserts: [],
  upsertError: null,
  emailCfg: null,
  domainRow: null,
  rpcCalls: [],
  rpcError: null,
};

function mockSupabase() {
  return {
    from: (table: string) => ({
      upsert: (row: unknown, opts?: unknown) => {
        state.upserts.push({ table, row, opts });
        return Promise.resolve({ data: null, error: state.upsertError });
      },
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: table === "team_email_config" ? state.emailCfg : null,
              error: null,
            }),
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: state.domainRow, error: null }),
          }),
        }),
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: state.rpcError });
    },
  };
}

import {
  addEmailDomainAction,
  updateEmailConfigAction,
  updateMessageTemplateAction,
  verifyEmailDomainAction,
} from "./actions";

function resetState(): void {
  state.upserts = [];
  state.upsertError = null;
  state.emailCfg = { api_key_encrypted: "stored-cipher" };
  state.domainRow = { provider_domain_id: "rsd_1", domain: "acme.com" };
  state.rpcCalls = [];
  state.rpcError = null;
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({
    userId: fakeUserId,
    role: "owner",
  });
  mockRevalidatePath.mockReset();
  mockEncryptForTeam.mockReset();
  mockEncryptForTeam.mockResolvedValue("fresh-cipher");
  mockDecryptForTeam.mockReset();
  mockDecryptForTeam.mockResolvedValue("rsnd_api_key");
  mockSenderFor.mockClear();
  mockEnsureDomain.mockReset();
  mockEnsureDomain.mockResolvedValue({
    providerDomainId: "rsd_1",
    status: "pending",
    dnsRecords: [{ type: "TXT" }],
    failureReason: null,
  });
  mockRefreshDomain.mockReset();
  mockRefreshDomain.mockResolvedValue({
    status: "verified",
    dnsRecords: null,
    failureReason: null,
  });
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function cfgUpsert(): Record<string, unknown> {
  const u = state.upserts.find((x) => x.table === "team_email_config");
  if (!u) throw new Error("no team_email_config upsert recorded");
  return u.row as Record<string, unknown>;
}

describe("updateEmailConfigAction", () => {
  beforeEach(resetState);

  it("requires team_id", async () => {
    await expect(updateEmailConfigAction(fd({}))).rejects.toThrow(
      /team_id is required/,
    );
    expect(state.upserts).toEqual([]);
  });

  it("rejects a plain member with a clear refusal", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      updateEmailConfigAction(fd({ team_id: "t1" })),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "CONFLICT",
      message: expect.stringMatching(/owners and admins/) as unknown,
    });
    expect(state.upserts).toEqual([]);
  });

  it("upserts the config with trimmed values and the default daily cap of 50", async () => {
    await updateEmailConfigAction(
      fd({
        team_id: "t1",
        from_email: " billing@acme.com ",
        from_name: "Acme\r\nBilling",
        reply_to_email: "owner@acme.com",
        signature: "-- Acme",
      }),
    );
    expect(cfgUpsert()).toMatchObject({
      team_id: "t1",
      from_email: "billing@acme.com",
      // CRLF stripped by sanitizeHeaderValue — header-injection guard.
      from_name: "Acme Billing",
      reply_to_email: "owner@acme.com",
      signature: "-- Acme",
      daily_cap: 50,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t1/email");
  });

  it("clamps daily_cap into 0..1000", async () => {
    await updateEmailConfigAction(fd({ team_id: "t1", daily_cap: "99999" }));
    expect(cfgUpsert().daily_cap).toBe(1000);
  });

  it("rejects an invalid From address", async () => {
    await expect(
      updateEmailConfigAction(fd({ team_id: "t1", from_email: "not-an-email" })),
    ).rejects.toThrow(/not a valid email/);
    expect(state.upserts).toEqual([]);
  });

  it("rejects a role-address From (noreply@) — domain-reputation guard", async () => {
    await expect(
      updateEmailConfigAction(
        fd({ team_id: "t1", from_email: "noreply@acme.com" }),
      ),
    ).rejects.toThrow(/not a valid email/);
  });

  it("rejects an invalid Reply-To address", async () => {
    await expect(
      updateEmailConfigAction(
        fd({ team_id: "t1", reply_to_email: "nope@" }),
      ),
    ).rejects.toThrow(/Reply-To address/);
  });

  it("encrypts a newly-pasted API key and defaults its rotate-by date to +1y", async () => {
    await updateEmailConfigAction(
      fd({ team_id: "t1", api_key: " rsnd_secret " }),
    );
    expect(mockEncryptForTeam).toHaveBeenCalledWith(
      expect.anything(),
      "t1",
      "rsnd_secret",
    );
    const row = cfgUpsert();
    expect(row.api_key_encrypted).toBe("pg(fresh-cipher)");
    // defaultExpiryYear() is deterministic (UTC calendar day + 1y).
    expect(row.api_key_expires_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a user-picked rotate-by date wins over the +1y default", async () => {
    await updateEmailConfigAction(
      fd({
        team_id: "t1",
        api_key: "rsnd_secret",
        api_key_expires_at: "2027-01-31",
      }),
    );
    expect(cfgUpsert().api_key_expires_at).toBe("2027-01-31");
  });

  it("blank api_key leaves the stored key untouched (no api_key_encrypted in the patch)", async () => {
    await updateEmailConfigAction(fd({ team_id: "t1", api_key: "  " }));
    const row = cfgUpsert();
    expect(row).not.toHaveProperty("api_key_encrypted");
    expect(row).not.toHaveProperty("api_key_expires_at");
    expect(mockEncryptForTeam).not.toHaveBeenCalled();
  });

  it("saves only a new rotate-by date when no key is pasted", async () => {
    await updateEmailConfigAction(
      fd({ team_id: "t1", api_key_expires_at: "2026-12-01" }),
    );
    const row = cfgUpsert();
    expect(row.api_key_expires_at).toBe("2026-12-01");
    expect(row).not.toHaveProperty("api_key_encrypted");
  });

  it("propagates a Supabase upsert error as an AppError", async () => {
    state.upsertError = { message: "rls says no", code: "42501" };
    await expect(
      updateEmailConfigAction(fd({ team_id: "t1" })),
    ).rejects.toMatchObject({ name: "AppError", code: "AUTH_FORBIDDEN" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("addEmailDomainAction", () => {
  beforeEach(resetState);

  function domainFd(domain: string): FormData {
    return fd({ team_id: "t1", domain });
  }

  it("rejects an invalid domain", async () => {
    await expect(addEmailDomainAction(domainFd("not a domain"))).rejects.toThrow(
      /not a valid domain/,
    );
    expect(mockSenderFor).not.toHaveBeenCalled();
  });

  it("rejects a plain member", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(addEmailDomainAction(domainFd("acme.com"))).rejects.toThrow(
      /owners and admins/,
    );
  });

  it("refuses when no API key has been saved yet", async () => {
    state.emailCfg = null;
    await expect(addEmailDomainAction(domainFd("acme.com"))).rejects.toThrow(
      /Save an API key first/,
    );
    expect(mockSenderFor).not.toHaveBeenCalled();
  });

  it("maps a decrypt failure (rotated KEK) to a re-paste refusal, not a crash", async () => {
    mockDecryptForTeam.mockRejectedValue(new Error("auth tag mismatch"));
    await expect(
      addEmailDomainAction(domainFd("acme.com")),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "CONFLICT",
      message: expect.stringMatching(/can't be decrypted/) as unknown,
    });
  });

  it("refuses when decryption yields null", async () => {
    mockDecryptForTeam.mockResolvedValue(null);
    await expect(addEmailDomainAction(domainFd("acme.com"))).rejects.toThrow(
      /Re-paste your Resend API key/,
    );
  });

  it("normalizes the domain, registers it with Resend, and persists via the SECURITY DEFINER RPC", async () => {
    await addEmailDomainAction(domainFd("  ACME.com "));
    expect(mockSenderFor).toHaveBeenCalledWith("resend", "rsnd_api_key");
    expect(mockEnsureDomain).toHaveBeenCalledWith("acme.com");
    expect(state.rpcCalls).toEqual([
      {
        name: "upsert_email_domain_state_definer",
        args: {
          p_team_id: "t1",
          p_domain: "acme.com",
          p_provider_domain_id: "rsd_1",
          p_status: "pending",
          p_dns_records: [{ type: "TXT" }],
          p_failure_reason: null,
        },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t1/email");
  });

  it("propagates an RPC error (status write is trigger-locked; the RPC is the only writer)", async () => {
    state.rpcError = { message: "definer refused" };
    await expect(addEmailDomainAction(domainFd("acme.com"))).rejects.toMatchObject(
      { message: "definer refused" },
    );
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("verifyEmailDomainAction", () => {
  beforeEach(resetState);

  function verifyFd(): FormData {
    return fd({ team_id: "t1", domain_id: "d1" });
  }

  it("requires team_id and domain_id", async () => {
    await expect(verifyEmailDomainAction(fd({ team_id: "t1" }))).rejects.toThrow(
      /team_id and domain_id are required/,
    );
  });

  it("throws when the domain row is missing or has no provider id", async () => {
    state.domainRow = null;
    await expect(verifyEmailDomainAction(verifyFd())).rejects.toThrow(
      /Domain row not found/,
    );
    state.domainRow = { provider_domain_id: null, domain: "acme.com" };
    await expect(verifyEmailDomainAction(verifyFd())).rejects.toThrow(
      /Domain row not found/,
    );
  });

  it("verified: refreshes by provider id, persists via RPC, revalidates, and resolves quietly", async () => {
    mockRefreshDomain.mockResolvedValue({
      status: "verified",
      dnsRecords: [{ type: "MX" }],
      failureReason: null,
    });
    await verifyEmailDomainAction(verifyFd());
    expect(mockRefreshDomain).toHaveBeenCalledWith("rsd_1");
    expect(state.rpcCalls[0]?.args).toMatchObject({
      p_team_id: "t1",
      p_domain: "acme.com",
      p_provider_domain_id: "rsd_1",
      p_status: "verified",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t1/email");
  });

  it("failed: surfaces the provider's failure reason as an info-severity refusal", async () => {
    mockRefreshDomain.mockResolvedValue({
      status: "failed",
      dnsRecords: null,
      failureReason: "SPF record missing",
    });
    await expect(verifyEmailDomainAction(verifyFd())).rejects.toMatchObject({
      name: "AppError",
      code: "CONFLICT",
      severity: "info",
      message: expect.stringMatching(
        /Verification failed: SPF record missing/,
      ) as unknown,
    });
    // State DID change — revalidate must fire even on the throw path.
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t1/email");
  });

  it("failed with no reason: generic double-check message", async () => {
    mockRefreshDomain.mockResolvedValue({
      status: "failed",
      dnsRecords: null,
      failureReason: null,
    });
    await expect(verifyEmailDomainAction(verifyFd())).rejects.toThrow(
      /Verification failed\. Double-check the DNS records/,
    );
  });

  it("pending: explains the propagation timing gap as a refusal (expected outcome, not an error)", async () => {
    mockRefreshDomain.mockResolvedValue({
      status: "pending",
      dnsRecords: null,
      failureReason: null,
    });
    await expect(verifyEmailDomainAction(verifyFd())).rejects.toMatchObject({
      name: "AppError",
      severity: "info",
      message: expect.stringMatching(/Still pending/) as unknown,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t1/email");
  });

  it("maps a decrypt failure to the re-paste refusal", async () => {
    mockDecryptForTeam.mockRejectedValue(new Error("bad tag"));
    await expect(verifyEmailDomainAction(verifyFd())).rejects.toThrow(
      /can't be decrypted/,
    );
    expect(mockRefreshDomain).not.toHaveBeenCalled();
  });

  it("throws when the API key config is missing", async () => {
    state.emailCfg = null;
    await expect(verifyEmailDomainAction(verifyFd())).rejects.toThrow(
      /API key missing/,
    );
  });
});

describe("updateMessageTemplateAction", () => {
  beforeEach(resetState);

  it("upserts the template keyed on (team_id, kind)", async () => {
    await updateMessageTemplateAction(
      fd({
        team_id: "t1",
        kind: "invoice_send",
        subject: "Invoice {{invoice_number}}",
        body: "Hi {{customer_name}},",
      }),
    );
    expect(state.upserts).toEqual([
      {
        table: "message_templates",
        row: {
          team_id: "t1",
          kind: "invoice_send",
          subject: "Invoice {{invoice_number}}",
          body: "Hi {{customer_name}},",
        },
        opts: { onConflict: "team_id,kind" },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t1/email");
  });

  it("rejects an unknown template kind", async () => {
    await expect(
      updateMessageTemplateAction(
        fd({ team_id: "t1", kind: "spam_blast", subject: "s", body: "b" }),
      ),
    ).rejects.toThrow(/Invalid template kind: spam_blast/);
    expect(state.upserts).toEqual([]);
  });

  it("requires subject and body (whitespace-only rejected)", async () => {
    await expect(
      updateMessageTemplateAction(
        fd({ team_id: "t1", kind: "invoice_reminder", subject: "  ", body: "b" }),
      ),
    ).rejects.toThrow(/Subject is required/);
    await expect(
      updateMessageTemplateAction(
        fd({ team_id: "t1", kind: "invoice_reminder", subject: "s", body: "" }),
      ),
    ).rejects.toThrow(/Body is required/);
    expect(state.upserts).toEqual([]);
  });

  it("rejects a plain member", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      updateMessageTemplateAction(
        fd({ team_id: "t1", kind: "payment_thanks", subject: "s", body: "b" }),
      ),
    ).rejects.toThrow(/owners and admins/);
    expect(state.upserts).toEqual([]);
  });

  it("propagates a Supabase upsert error", async () => {
    state.upsertError = { message: "nope" };
    await expect(
      updateMessageTemplateAction(
        fd({ team_id: "t1", kind: "invoice_send", subject: "s", body: "b" }),
      ),
    ).rejects.toMatchObject({ name: "AppError", code: "DATABASE_ERROR" });
  });
});
