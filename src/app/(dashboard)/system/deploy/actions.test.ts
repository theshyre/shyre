import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock runSafeAction to strip the auth boundary (covered by
// safe-action.test.ts). The Vercel boundary is mocked at
// deployProviderFor — provider HTTP behavior lives in
// src/lib/deploy/providers/vercel.test.ts.
const fakeUserId = "u-sysadmin";
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

const mockIsSystemAdmin = vi.fn();
vi.mock("@/lib/system-admin", () => ({
  isSystemAdmin: () => mockIsSystemAdmin(),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

interface ProviderStub {
  upsertEnvVar: ReturnType<typeof vi.fn>;
  triggerRedeploy: ReturnType<typeof vi.fn>;
  readEnvVar?: ReturnType<typeof vi.fn>;
}

const mockUpsertEnvVar = vi.fn();
const mockTriggerRedeploy = vi.fn();
const mockReadEnvVar = vi.fn();
const mockDeployProviderFor = vi.fn();
vi.mock("@/lib/deploy", () => ({
  deployProviderFor: (...args: unknown[]) => mockDeployProviderFor(...args),
}));

interface SupaError {
  message: string;
  code?: string;
}

const state: {
  /** Row returned for `instance_deploy_config` id=1. */
  deployCfg: {
    api_token: string | null;
    project_id: string | null;
    vercel_team_id: string | null;
    deploy_hook_url: string | null;
  } | null;
  upserts: { table: string; row: Record<string, unknown>; opts?: unknown }[];
  updates: { table: string; patch: Record<string, unknown> }[];
  upsertError: SupaError | null;
} = {
  deployCfg: null,
  upserts: [],
  updates: [],
  upsertError: null,
};

function mockSupabase() {
  return {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>, opts?: unknown) => {
        state.upserts.push({ table, row, opts });
        return Promise.resolve({ data: null, error: state.upsertError });
      },
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: state.deployCfg, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => {
          state.updates.push({ table, patch });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  };
}

import {
  provisionEncryptionKeyAction,
  setEnvVarAction,
  triggerRedeployAction,
  updateDeployConfigAction,
} from "./actions";

const ORIGINAL_KEY = process.env.EMAIL_KEY_ENCRYPTION_KEY;

function providerStub(withRead: boolean): ProviderStub {
  const p: ProviderStub = {
    upsertEnvVar: mockUpsertEnvVar,
    triggerRedeploy: mockTriggerRedeploy,
  };
  if (withRead) p.readEnvVar = mockReadEnvVar;
  return p;
}

function resetState(): void {
  state.deployCfg = {
    api_token: "vrc_token",
    project_id: "prj_1",
    vercel_team_id: null,
    deploy_hook_url: "https://api.vercel.com/v1/integrations/deploy/prj_1/hook",
  };
  state.upserts = [];
  state.updates = [];
  state.upsertError = null;
  mockIsSystemAdmin.mockReset();
  mockIsSystemAdmin.mockResolvedValue(true);
  mockRevalidatePath.mockReset();
  mockUpsertEnvVar.mockReset();
  mockUpsertEnvVar.mockResolvedValue({ envVarId: "env_1", created: true });
  mockTriggerRedeploy.mockReset();
  mockTriggerRedeploy.mockResolvedValue({ deploymentId: "dpl_1" });
  mockReadEnvVar.mockReset();
  mockReadEnvVar.mockResolvedValue({ exists: false, value: null });
  mockDeployProviderFor.mockReset();
  mockDeployProviderFor.mockImplementation(() => providerStub(true));
  delete process.env.EMAIL_KEY_ENCRYPTION_KEY;
}

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.EMAIL_KEY_ENCRYPTION_KEY;
  } else {
    process.env.EMAIL_KEY_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updateDeployConfigAction", () => {
  beforeEach(resetState);

  const goodForm = {
    api_token: "vrc_new",
    project_id: "prj_9",
  };

  it("refuses non-system-admins before reading anything", async () => {
    mockIsSystemAdmin.mockResolvedValue(false);
    await expect(
      updateDeployConfigAction(fd(goodForm)),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "CONFLICT",
      message: "System admins only.",
    });
    expect(state.upserts).toEqual([]);
  });

  it("requires token and project id", async () => {
    await expect(
      updateDeployConfigAction(fd({ project_id: "p" })),
    ).rejects.toThrow(/API token is required/);
    await expect(
      updateDeployConfigAction(fd({ api_token: "t" })),
    ).rejects.toThrow(/project ID is required/);
    expect(state.upserts).toEqual([]);
  });

  it("rejects a deploy hook that is not an api.vercel.com URL", async () => {
    await expect(
      updateDeployConfigAction(
        fd({ ...goodForm, deploy_hook_url: "https://evil.example/hook" }),
      ),
    ).rejects.toThrow(/must start with https:\/\/api\.vercel\.com\//);
    expect(state.upserts).toEqual([]);
  });

  it("probes the token via readEnvVar and surfaces a reachability failure instead of saving a broken token", async () => {
    mockReadEnvVar.mockRejectedValue(new Error("401 invalid token"));
    await expect(updateDeployConfigAction(fd(goodForm))).rejects.toThrow(
      /Could not reach Vercel .* 401 invalid token/,
    );
    expect(state.upserts).toEqual([]);
  });

  it("persists the validated connection as the id=1 singleton with a defaulted rotate-by date", async () => {
    await updateDeployConfigAction(fd(goodForm));
    expect(mockDeployProviderFor).toHaveBeenCalledWith("vercel", {
      apiToken: "vrc_new",
      projectId: "prj_9",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    const u = state.upserts.find((x) => x.table === "instance_deploy_config");
    expect(u?.row).toMatchObject({
      id: 1,
      provider: "vercel",
      api_token: "vrc_new",
      project_id: "prj_9",
      vercel_team_id: null,
      deploy_hook_url: null,
    });
    // Blank date → today + 365d (defaultExpiryYear shape).
    expect(u?.row.api_token_expires_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(u?.opts).toEqual({ onConflict: "id" });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/system/deploy");
  });

  it("a user-picked rotate-by date wins over the default", async () => {
    await updateDeployConfigAction(
      fd({ ...goodForm, api_token_expires_at: "2027-03-01" }),
    );
    const u = state.upserts.find((x) => x.table === "instance_deploy_config");
    expect(u?.row.api_token_expires_at).toBe("2027-03-01");
  });

  it("skips the probe when the provider does not support readEnvVar", async () => {
    mockDeployProviderFor.mockImplementation(() => providerStub(false));
    await updateDeployConfigAction(fd(goodForm));
    expect(mockReadEnvVar).not.toHaveBeenCalled();
    expect(state.upserts).toHaveLength(1);
  });
});

describe("provisionEncryptionKeyAction", () => {
  beforeEach(resetState);

  it("refuses non-system-admins", async () => {
    mockIsSystemAdmin.mockResolvedValue(false);
    await expect(provisionEncryptionKeyAction(fd({}))).rejects.toThrow(
      /System admins only/,
    );
    expect(mockUpsertEnvVar).not.toHaveBeenCalled();
  });

  it("refuses to rotate an existing key without the typed 'regenerate' confirmation", async () => {
    process.env.EMAIL_KEY_ENCRYPTION_KEY = "deadbeef";
    await expect(
      provisionEncryptionKeyAction(fd({})),
    ).rejects.toMatchObject({
      name: "AppError",
      severity: "info",
      message: expect.stringMatching(/type 'regenerate'/) as unknown,
    });
    expect(mockUpsertEnvVar).not.toHaveBeenCalled();
  });

  it("rotates when 'regenerate' is typed", async () => {
    process.env.EMAIL_KEY_ENCRYPTION_KEY = "deadbeef";
    await provisionEncryptionKeyAction(fd({ confirm: "regenerate" }));
    expect(mockUpsertEnvVar).toHaveBeenCalledTimes(1);
  });

  it("requires a connected Vercel project", async () => {
    state.deployCfg = null;
    await expect(provisionEncryptionKeyAction(fd({}))).rejects.toThrow(
      /Connect Vercel first/,
    );
    expect(mockUpsertEnvVar).not.toHaveBeenCalled();
  });

  it("writes a fresh 32-byte hex key to all three env tiers (encrypted) and redeploys", async () => {
    await provisionEncryptionKeyAction(fd({}));
    expect(mockUpsertEnvVar).toHaveBeenCalledTimes(1);
    const input = mockUpsertEnvVar.mock.calls[0]?.[0] as {
      key: string;
      value: string;
      targets: string[];
      encrypt: boolean;
    };
    expect(input.key).toBe("EMAIL_KEY_ENCRYPTION_KEY");
    expect(input.value).toMatch(/^[0-9a-f]{64}$/);
    expect(input.targets).toEqual(["production", "preview", "development"]);
    expect(input.encrypt).toBe(true);
    expect(mockTriggerRedeploy).toHaveBeenCalledTimes(1);
    expect(state.updates[0]?.patch).toHaveProperty("last_synced_at");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/system/deploy");
  });

  it("skips the redeploy when no deploy hook is configured", async () => {
    state.deployCfg = {
      api_token: "vrc_token",
      project_id: "prj_1",
      vercel_team_id: null,
      deploy_hook_url: null,
    };
    await provisionEncryptionKeyAction(fd({}));
    expect(mockUpsertEnvVar).toHaveBeenCalledTimes(1);
    expect(mockTriggerRedeploy).not.toHaveBeenCalled();
  });
});

describe("setEnvVarAction", () => {
  beforeEach(resetState);

  it("refuses non-system-admins", async () => {
    mockIsSystemAdmin.mockResolvedValue(false);
    await expect(
      setEnvVarAction(fd({ key: "RESEND_WEBHOOK_SECRET", value: "whsec_1" })),
    ).rejects.toThrow(/System admins only/);
  });

  it("refuses any key outside the allow-list (forged-POST guard)", async () => {
    await expect(
      setEnvVarAction(fd({ key: "AWS_SECRET_ACCESS_KEY", value: "x" })),
    ).rejects.toThrow(/not in allow-list: AWS_SECRET_ACCESS_KEY/);
    expect(mockUpsertEnvVar).not.toHaveBeenCalled();
  });

  it("requires a value", async () => {
    await expect(
      setEnvVarAction(fd({ key: "RESEND_WEBHOOK_SECRET", value: "  " })),
    ).rejects.toThrow(/Value is required/);
  });

  it("requires a connected Vercel project", async () => {
    state.deployCfg = null;
    await expect(
      setEnvVarAction(fd({ key: "RESEND_WEBHOOK_SECRET", value: "whsec_1" })),
    ).rejects.toThrow(/Connect Vercel first/);
  });

  it("writes the allow-listed var encrypted to all tiers, redeploys, and stamps last_synced_at", async () => {
    await setEnvVarAction(
      fd({ key: "RESEND_WEBHOOK_SECRET", value: " whsec_1 " }),
    );
    expect(mockUpsertEnvVar).toHaveBeenCalledWith({
      key: "RESEND_WEBHOOK_SECRET",
      value: "whsec_1",
      targets: ["production", "preview", "development"],
      encrypt: true,
    });
    expect(mockTriggerRedeploy).toHaveBeenCalledTimes(1);
    expect(state.updates[0]?.patch).toHaveProperty("last_synced_at");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/system/deploy");
  });

  it("skips the redeploy when no deploy hook is configured", async () => {
    state.deployCfg = {
      api_token: "vrc_token",
      project_id: "prj_1",
      vercel_team_id: null,
      deploy_hook_url: null,
    };
    await setEnvVarAction(
      fd({ key: "RESEND_WEBHOOK_SECRET", value: "whsec_1" }),
    );
    expect(mockTriggerRedeploy).not.toHaveBeenCalled();
  });
});

describe("triggerRedeployAction", () => {
  beforeEach(resetState);

  it("refuses non-system-admins", async () => {
    mockIsSystemAdmin.mockResolvedValue(false);
    await expect(triggerRedeployAction(fd({}))).rejects.toThrow(
      /System admins only/,
    );
    expect(mockTriggerRedeploy).not.toHaveBeenCalled();
  });

  it("throws when no deploy hook is configured", async () => {
    state.deployCfg = {
      api_token: "vrc_token",
      project_id: "prj_1",
      vercel_team_id: null,
      deploy_hook_url: null,
    };
    await expect(triggerRedeployAction(fd({}))).rejects.toThrow(
      /Deploy hook URL not configured/,
    );
    expect(mockTriggerRedeploy).not.toHaveBeenCalled();
  });

  it("triggers a redeploy through the configured provider and revalidates", async () => {
    await triggerRedeployAction(fd({}));
    expect(mockDeployProviderFor).toHaveBeenCalledWith("vercel", {
      apiToken: "vrc_token",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl:
        "https://api.vercel.com/v1/integrations/deploy/prj_1/hook",
    });
    expect(mockTriggerRedeploy).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/system/deploy");
  });

  it("propagates a provider failure (hook 404) to the caller", async () => {
    mockTriggerRedeploy.mockRejectedValue(new Error("hook returned 404"));
    await expect(triggerRedeployAction(fd({}))).rejects.toThrow(
      /hook returned 404/,
    );
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
