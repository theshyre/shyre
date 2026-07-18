import { describe, it, expect, vi, beforeEach } from "vitest";
import { sha256Hex, TOKEN_PREFIX } from "@/lib/integrations/tokens";

const fakeUserId = "u-owner";

interface SupabaseErrorShape {
  code: string;
  message: string;
}

const state: {
  user: { id: string } | null;
  inserts: { table: string; row: Record<string, unknown> }[];
  insertError: SupabaseErrorShape | null;
  updates: {
    table: string;
    patch: Record<string, unknown>;
    eq: Record<string, string>;
    is: Record<string, unknown>;
  }[];
  updateError: SupabaseErrorShape | null;
  updateReturns: { id: string }[];
  upserts: { table: string; row: Record<string, unknown> }[];
  upsertError: SupabaseErrorShape | null;
} = {
  user: { id: fakeUserId },
  inserts: [],
  insertError: null,
  updates: [],
  updateError: null,
  updateReturns: [{ id: "tok-1" }],
  upserts: [],
  upsertError: null,
};

function mockSupabase() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: state.user } }),
    },
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        state.inserts.push({ table, row });
        return Promise.resolve({ data: null, error: state.insertError });
      },
      upsert: (row: Record<string, unknown>) => {
        state.upserts.push({ table, row });
        return Promise.resolve({ data: null, error: state.upsertError });
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => ({
          is: (isCol: string, isVal: unknown) => ({
            select: () => {
              state.updates.push({
                table,
                patch,
                eq: { [col]: val },
                is: { [isCol]: isVal },
              });
              return Promise.resolve({
                data: state.updateError ? null : state.updateReturns,
                error: state.updateError,
              });
            },
          }),
        }),
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

// Mirror the real runSafeAction result contract (toAppError → toUserSafe)
// so sanitization behavior — which keys/messages reach the client — is
// what these tests actually pin down.
vi.mock("@/lib/safe-action", async () => {
  const { toAppError } = await import("@/lib/errors");
  return {
    runSafeAction: async (
      formData: FormData,
      fn: (
        fd: FormData,
        ctx: { supabase: unknown; userId: string },
      ) => Promise<void>,
    ) => {
      try {
        await fn(formData, { supabase: mockSupabase(), userId: fakeUserId });
        return { success: true };
      } catch (err) {
        return { success: false, error: toAppError(err).toUserSafe() };
      }
    },
  };
});

const mockValidateTeamAccess = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateTeamAccess: (...args: unknown[]) => mockValidateTeamAccess(...args),
  isTeamAdmin: (role: string) => role === "owner" || role === "admin",
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import {
  createIntegrationTokenAction,
  revokeIntegrationTokenAction,
  setIntegrationsEnabledAction,
} from "./actions";

interface ActionResultShape {
  success: boolean;
  error?: {
    message?: string;
    userMessageKey?: string;
    fieldErrors?: Record<string, string>;
  };
}

function createFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("team_id", "t-1");
  fd.set("name", "Claude Code on laptop");
  fd.set("ttl_days", "90");
  fd.set("default_billable", "true");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.user = { id: fakeUserId };
  state.inserts = [];
  state.insertError = null;
  state.updates = [];
  state.updateError = null;
  state.updateReturns = [{ id: "tok-1" }];
  state.upserts = [];
  state.upsertError = null;
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({
    userId: fakeUserId,
    role: "owner",
  });
  mockRevalidatePath.mockReset();
  mockLogError.mockReset();
});

describe("createIntegrationTokenAction", () => {
  it("inserts a hashed token and returns the raw value once", async () => {
    const result = await createIntegrationTokenAction(createFormData());

    expect(result.success).toBe(true);
    expect(result.rawToken).toBeDefined();
    expect(result.rawToken!.startsWith(TOKEN_PREFIX)).toBe(true);

    expect(state.inserts).toHaveLength(1);
    const insert = state.inserts[0]!;
    expect(insert.table).toBe("integration_tokens");
    // Only the sha256 hash is stored — never the raw token.
    expect(insert.row.token_hash).toBe(sha256Hex(result.rawToken!));
    expect(insert.row.token_hash).not.toBe(result.rawToken);
    expect(insert.row.token_prefix).toBe(
      result.rawToken!.slice(0, TOKEN_PREFIX.length + 6),
    );
    expect(insert.row.user_id).toBe(fakeUserId);
    expect(insert.row.team_id).toBe("t-1");
    expect(insert.row.name).toBe("Claude Code on laptop");
    expect(insert.row.default_billable).toBe(true);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/integrations");
  });

  it("verifies team membership server-side before inserting (two-layer rule)", async () => {
    await createIntegrationTokenAction(createFormData());
    expect(mockValidateTeamAccess).toHaveBeenCalledWith("t-1");

    mockValidateTeamAccess.mockRejectedValue(
      new Error("You do not have access to this team."),
    );
    const result = await createIntegrationTokenAction(createFormData());
    expect(result.success).toBe(false);
    // Membership failed → the second call generated and inserted nothing.
    expect(state.inserts).toHaveLength(1);
  });

  it("redirects to login when unauthenticated", async () => {
    state.user = null;
    await expect(
      createIntegrationTokenAction(createFormData()),
    ).rejects.toThrow("REDIRECT:/login");
    expect(state.inserts).toHaveLength(0);
  });

  it("sets expires_at from the chosen preset", async () => {
    const before = Date.now();
    const result = await createIntegrationTokenAction(
      createFormData({ ttl_days: "30" }),
    );
    expect(result.success).toBe(true);
    const expiresAt = new Date(
      state.inserts[0]!.row.expires_at as string,
    ).getTime();
    const days = (expiresAt - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("honors the non-billable one-time choice", async () => {
    const result = await createIntegrationTokenAction(
      createFormData({ default_billable: "false" }),
    );
    expect(result.success).toBe(true);
    expect(state.inserts[0]!.row.default_billable).toBe(false);
  });

  it("rejects a missing team id", async () => {
    const fd = createFormData();
    fd.delete("team_id");
    const result = await createIntegrationTokenAction(fd);
    expect(result.success).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects a missing or over-long name with a field error", async () => {
    for (const name of ["   ", "x".repeat(101)]) {
      const result = await createIntegrationTokenAction(
        createFormData({ name }),
      );
      expect(result.success).toBe(false);
      expect(result.rawToken).toBeUndefined();
      expect(result.error?.fieldErrors?.name).toBe(
        "integrations.create.nameRequired",
      );
    }
    expect(state.inserts).toHaveLength(0);
    expect(mockLogError).toHaveBeenCalled();
  });

  it("rejects an off-preset or over-max expiry", async () => {
    for (const ttl of ["7", "9000", "not-a-number"]) {
      const result = await createIntegrationTokenAction(
        createFormData({ ttl_days: ttl }),
      );
      expect(result.success).toBe(false);
    }
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects a missing billable choice", async () => {
    const fd = createFormData();
    fd.delete("default_billable");
    const result = await createIntegrationTokenAction(fd);
    expect(result.success).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it("maps an RLS rejection to the friendly integrations-disabled key", async () => {
    state.insertError = {
      code: "42501",
      message: "new row violates row-level security policy",
    };
    const result = await createIntegrationTokenAction(createFormData());
    expect(result.success).toBe(false);
    expect(result.error?.userMessageKey).toBe("integrations.errors.disabled");
    expect(result.rawToken).toBeUndefined();
    expect(mockLogError).toHaveBeenCalled();
  });

  it("sanitizes other database errors instead of forwarding raw Postgres text", async () => {
    state.insertError = {
      code: "22P02",
      message: 'invalid input syntax for type uuid: "attacker-string"',
    };
    const result = await createIntegrationTokenAction(createFormData());
    expect(result.success).toBe(false);
    // fromSupabase classifies to DATABASE_ERROR → i18n key only; the
    // raw Postgres message must not reach the client.
    expect(result.error?.userMessageKey).toBe("errors.database");
    expect(result.error?.message).toBeUndefined();
  });

  it("never logs the raw token or its hash when the insert fails post-generation", async () => {
    // The dangerous window: the token EXISTS in scope when the insert
    // fails. A regression that attaches the row or raw error object to
    // the log context would leak it.
    state.insertError = {
      code: "42501",
      message: "new row violates row-level security policy",
    };
    const result = await createIntegrationTokenAction(createFormData());
    expect(result.success).toBe(false);
    expect(mockLogError).toHaveBeenCalled();
    const logged = JSON.stringify(mockLogError.mock.calls);
    expect(logged).not.toContain(TOKEN_PREFIX);
    // sha256 hex is a 64-char lowercase hex blob — none may appear.
    expect(logged).not.toMatch(/[a-f0-9]{64}/);
  });
});

describe("revokeIntegrationTokenAction", () => {
  function revokeFd(tokenId?: string): FormData {
    const fd = new FormData();
    if (tokenId) fd.set("token_id", tokenId);
    fd.set("team_id", "t-1");
    return fd;
  }

  it("stamps revoked_at on the target token", async () => {
    const result = (await revokeIntegrationTokenAction(
      revokeFd("tok-1"),
    )) as unknown as ActionResultShape;

    expect(result.success).toBe(true);
    expect(state.updates).toHaveLength(1);
    const update = state.updates[0]!;
    expect(update.table).toBe("integration_tokens");
    expect(update.eq.id).toBe("tok-1");
    // Guard: only un-revoked tokens are targeted (.is("revoked_at", null)).
    expect(update.is).toEqual({ revoked_at: null });
    // revoked_at is a fresh timestamp, the only patched column.
    expect(Object.keys(update.patch)).toEqual(["revoked_at"]);
    expect(
      Math.abs(
        new Date(update.patch.revoked_at as string).getTime() - Date.now(),
      ),
    ).toBeLessThan(5000);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/integrations");
  });

  it("fails loudly with an i18n key when RLS filtered the update to zero rows", async () => {
    state.updateReturns = [];
    const result = (await revokeIntegrationTokenAction(
      revokeFd("tok-x"),
    )) as unknown as ActionResultShape;
    expect(result.success).toBe(false);
    expect(result.error?.userMessageKey).toBe(
      "integrations.errors.revokeNotFound",
    );
  });

  it("sanitizes a database failure on the update", async () => {
    state.updateError = {
      code: "XX000",
      message: "internal postgres detail that must not surface",
    };
    const result = (await revokeIntegrationTokenAction(
      revokeFd("tok-1"),
    )) as unknown as ActionResultShape;
    expect(result.success).toBe(false);
    expect(result.error?.userMessageKey).toBe("errors.database");
    expect(result.error?.message).toBeUndefined();
  });

  it("requires a token id", async () => {
    const result = (await revokeIntegrationTokenAction(
      revokeFd(),
    )) as unknown as ActionResultShape;
    expect(result.success).toBe(false);
    expect(state.updates).toHaveLength(0);
  });
});

describe("setIntegrationsEnabledAction", () => {
  function toggleFd(enabled: string): FormData {
    const fd = new FormData();
    fd.set("team_id", "t-1");
    fd.set("enabled", enabled);
    return fd;
  }

  it("lets an owner enable integrations", async () => {
    const result = (await setIntegrationsEnabledAction(
      toggleFd("true"),
    )) as unknown as ActionResultShape;
    expect(result.success).toBe(true);
    expect(state.upserts).toEqual([
      {
        table: "team_settings",
        row: { team_id: "t-1", integrations_enabled: true },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/integrations");
  });

  it("lets an admin disable integrations (kill switch)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    const result = (await setIntegrationsEnabledAction(
      toggleFd("false"),
    )) as unknown as ActionResultShape;
    expect(result.success).toBe(true);
    expect(state.upserts[0]!.row.integrations_enabled).toBe(false);
  });

  it("rejects a plain member with the adminOnly key (isTeamAdmin gate)", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    const result = (await setIntegrationsEnabledAction(
      toggleFd("true"),
    )) as unknown as ActionResultShape;
    expect(result.success).toBe(false);
    expect(result.error?.userMessageKey).toBe("integrations.errors.adminOnly");
    expect(state.upserts).toHaveLength(0);
  });

  it("rejects a malformed toggle value", async () => {
    const result = (await setIntegrationsEnabledAction(
      toggleFd("yes"),
    )) as unknown as ActionResultShape;
    expect(result.success).toBe(false);
    expect(state.upserts).toHaveLength(0);
  });

  it("sanitizes an upsert failure", async () => {
    state.upsertError = {
      code: "23502",
      message: 'null value in column "x" violates not-null constraint',
    };
    const result = (await setIntegrationsEnabledAction(
      toggleFd("true"),
    )) as unknown as ActionResultShape;
    expect(result.success).toBe(false);
    expect(result.error?.userMessageKey).toBe("errors.database");
    expect(result.error?.message).toBeUndefined();
  });
});
