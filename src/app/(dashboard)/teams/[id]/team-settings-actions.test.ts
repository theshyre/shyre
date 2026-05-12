import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * team-settings has three actions: updateTeamSettingsAction (the
 * big one — branding + invoicing defaults + rate-permission
 * delegation), setTeamRateAction (default rate setter, gated by the
 * `can_set_team_rate` RPC), and setTeamTimeEntriesVisibilityAction
 * (level enum write).
 *
 * Critical invariants to defend:
 *   - All three gate on isTeamAdmin / validateTeamAccess; member is rejected.
 *   - `can_set_team_rate` is the only gate that lets an admin (vs.
 *     owner-only) actually write the default_rate column. Honoring
 *     this is how the rate-permission-delegation flag works.
 *   - `time_entries_visibility` only accepts the three named levels.
 *   - admins_can_set_rate_permissions is owner-only even within owner|admin.
 */

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
vi.mock("@/lib/team-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/team-context")>(
    "@/lib/team-context",
  );
  return {
    ...actual,
    validateTeamAccess: (teamId: string) => mockValidateTeamAccess(teamId),
  };
});

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const state: {
  rpcResponses: Record<string, unknown>;
  rpcCalls: RpcCall[];
  upserts: { table: string; patch: unknown }[];
  upsertError: { message: string } | null;
} = {
  rpcResponses: {},
  rpcCalls: [],
  upserts: [],
  upsertError: null,
};

function mockSupabase() {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({
        data: state.rpcResponses[name],
        error: null,
      });
    },
    from: (table: string) => {
      const op: { kind: "upsert" | null; patch: unknown } = {
        kind: null,
        patch: null,
      };
      const chain: Record<string, unknown> = {
        upsert(patch: unknown) {
          op.kind = "upsert";
          op.patch = patch;
          return chain;
        },
        then(resolve: (v: { data: null; error: unknown }) => void) {
          if (op.kind === "upsert") {
            state.upserts.push({ table, patch: op.patch });
          }
          resolve({ data: null, error: state.upsertError });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  setTeamRateAction,
  setTeamTimeEntriesVisibilityAction,
  updateTeamSettingsAction,
} from "./team-settings-actions";

function reset(): void {
  state.rpcResponses = {};
  state.rpcCalls = [];
  state.upserts = [];
  state.upsertError = null;
  mockValidateTeamAccess.mockReset();
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updateTeamSettingsAction", () => {
  beforeEach(reset);

  it("rejects plain members", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "member" });
    await expect(
      updateTeamSettingsAction(fd({ team_id: "t-1" })),
    ).rejects.toThrow(/owners and admins/);
    expect(state.upserts).toHaveLength(0);
  });

  it("upserts the team_settings row with the team_id key", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await updateTeamSettingsAction(
      fd({
        team_id: "t-1",
        business_name: "Acme",
        business_email: "billing@acme.io",
        business_phone: "+1-555-0100",
        invoice_prefix: "ACME",
        invoice_next_num: "42",
        tax_rate: "8.25",
      }),
    );
    expect(state.upserts).toHaveLength(1);
    const patch = state.upserts[0]?.patch as Record<string, unknown>;
    expect(patch.team_id).toBe("t-1");
    expect(patch.business_name).toBe("Acme");
    expect(patch.invoice_prefix).toBe("ACME");
    expect(patch.invoice_next_num).toBe(42);
    expect(patch.tax_rate).toBeCloseTo(8.25, 2);
  });

  it("defaults invoice_prefix to 'INV' when omitted; numeric fields default sanely", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    await updateTeamSettingsAction(fd({ team_id: "t-1" }));
    const patch = state.upserts[0]?.patch as Record<string, unknown>;
    expect(patch.invoice_prefix).toBe("INV");
    expect(patch.invoice_next_num).toBe(1);
    expect(patch.tax_rate).toBe(0);
  });

  it("show_country_on_invoice reads from checkbox semantics ('on' → true, absent → false)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", show_country_on_invoice: "on" }),
    );
    expect(
      (state.upserts[0]?.patch as Record<string, unknown>).show_country_on_invoice,
    ).toBe(true);

    state.upserts = [];
    await updateTeamSettingsAction(fd({ team_id: "t-1" }));
    expect(
      (state.upserts[0]?.patch as Record<string, unknown>).show_country_on_invoice,
    ).toBe(false);
  });

  it("brand_color empty / whitespace normalizes to null", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await updateTeamSettingsAction(fd({ team_id: "t-1", brand_color: "   " }));
    expect(
      (state.upserts[0]?.patch as Record<string, unknown>).brand_color,
    ).toBeNull();
  });

  it("default_payment_terms_days clamps to 0..365 inclusive", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", default_payment_terms_days: "999" }),
    );
    expect(
      (state.upserts[0]?.patch as Record<string, unknown>).default_payment_terms_days,
    ).toBe(365);

    state.upserts = [];
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", default_payment_terms_days: "-50" }),
    );
    expect(
      (state.upserts[0]?.patch as Record<string, unknown>).default_payment_terms_days,
    ).toBe(0);
  });

  it("default_payment_terms_days empty string → null (Ask each time)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", default_payment_terms_days: "" }),
    );
    expect(
      (state.upserts[0]?.patch as Record<string, unknown>).default_payment_terms_days,
    ).toBeNull();
  });

  it("default_rate is ONLY written when can_set_team_rate RPC returns true", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    state.rpcResponses["can_set_team_rate"] = false;
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", default_rate: "150" }),
    );
    expect(state.rpcCalls).toContainEqual({
      name: "can_set_team_rate",
      args: { p_team_id: "t-1" },
    });
    expect(state.upserts[0]?.patch).not.toHaveProperty("default_rate");
  });

  it("default_rate IS written when can_set_team_rate returns true", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    state.rpcResponses["can_set_team_rate"] = true;
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", default_rate: "150" }),
    );
    expect((state.upserts[0]?.patch as Record<string, unknown>).default_rate).toBe(
      150,
    );
  });

  it("rate_visibility / rate_editability gated by can_set_rate_permissions RPC", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    state.rpcResponses["can_set_rate_permissions"] = false;
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", rate_visibility: "owner", rate_editability: "owner" }),
    );
    expect(state.upserts[0]?.patch).not.toHaveProperty("rate_visibility");
    expect(state.upserts[0]?.patch).not.toHaveProperty("rate_editability");
  });

  it("invalid time_entries_visibility level is silently dropped (not upserted)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", time_entries_visibility: "all_data_party_yolo" }),
    );
    expect(state.upserts[0]?.patch).not.toHaveProperty("time_entries_visibility");
  });

  it("admins_can_set_rate_permissions is owner-only (admin role is ignored even if submitted)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", admins_can_set_rate_permissions: "on" }),
    );
    expect(state.upserts[0]?.patch).not.toHaveProperty(
      "admins_can_set_rate_permissions",
    );
  });

  it("admins_can_set_rate_permissions IS written when role is owner", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await updateTeamSettingsAction(
      fd({ team_id: "t-1", admins_can_set_rate_permissions: "on" }),
    );
    expect(
      (state.upserts[0]?.patch as Record<string, unknown>)
        .admins_can_set_rate_permissions,
    ).toBe(true);
  });

  it("revalidates /teams/<id> on success", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await updateTeamSettingsAction(fd({ team_id: "t-1" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams/t-1");
  });
});

describe("setTeamRateAction", () => {
  beforeEach(reset);

  it("rejects missing team_id", async () => {
    await expect(setTeamRateAction(fd({}))).rejects.toThrow(/Team id/);
  });

  it("rejects when can_set_team_rate RPC returns false (rate-permission delegation gate)", async () => {
    state.rpcResponses["can_set_team_rate"] = false;
    await expect(
      setTeamRateAction(fd({ team_id: "t-1", default_rate: "150" })),
    ).rejects.toThrow(/Not authorized/);
    expect(state.upserts).toHaveLength(0);
  });

  it("happy path upserts default_rate scoped to team_id", async () => {
    state.rpcResponses["can_set_team_rate"] = true;
    await setTeamRateAction(fd({ team_id: "t-1", default_rate: "175.50" }));
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]).toEqual({
      table: "team_settings",
      patch: { team_id: "t-1", default_rate: 175.5 },
    });
  });

  it("empty default_rate string → 0", async () => {
    state.rpcResponses["can_set_team_rate"] = true;
    await setTeamRateAction(fd({ team_id: "t-1" }));
    expect((state.upserts[0]?.patch as Record<string, unknown>).default_rate).toBe(0);
  });
});

describe("setTeamTimeEntriesVisibilityAction", () => {
  beforeEach(reset);

  it("rejects missing team_id", async () => {
    await expect(
      setTeamTimeEntriesVisibilityAction(fd({ level: "own_only" })),
    ).rejects.toThrow(/Team id/);
  });

  it("rejects plain members", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "member" });
    await expect(
      setTeamTimeEntriesVisibilityAction(
        fd({ team_id: "t-1", level: "own_only" }),
      ),
    ).rejects.toThrow(/owners and admins/);
  });

  it.each(["own_only", "read_all", "read_write_all"])(
    "accepts allowed level %s",
    async (level) => {
      mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
      await setTeamTimeEntriesVisibilityAction(
        fd({ team_id: "t-1", level }),
      );
      expect(state.upserts[0]).toEqual({
        table: "team_settings",
        patch: { team_id: "t-1", time_entries_visibility: level },
      });
    },
  );

  it("rejects any level outside the allow-list", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await expect(
      setTeamTimeEntriesVisibilityAction(
        fd({ team_id: "t-1", level: "see_everything_including_other_teams" }),
      ),
    ).rejects.toThrow(/Invalid level/);
  });
});
