import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeUserId = "u-biz-admin";

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

const mockValidateBusinessAccess = vi.fn();
vi.mock("@/lib/team-context", () => ({
  validateBusinessAccess: (businessId: string) =>
    mockValidateBusinessAccess(businessId),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

interface Filter {
  col: string;
  value: unknown;
}

const state: {
  inserts: { table: string; rows: unknown }[];
  updates: { table: string; patch: Record<string, unknown>; filters: Filter[] }[];
  insertError: { message: string; code?: string } | null;
  updateError: { message: string; code?: string } | null;
} = {
  inserts: [],
  updates: [],
  insertError: null,
  updateError: null,
};

function mockSupabase() {
  return {
    from: (table: string) => ({
      insert(rows: unknown) {
        state.inserts.push({ table, rows });
        return Promise.resolve({ data: null, error: state.insertError });
      },
      update(patch: Record<string, unknown>) {
        const filters: Filter[] = [];
        const rec = { table, patch, filters };
        const chain: Record<string, unknown> = {
          eq(col: string, value: unknown) {
            filters.push({ col, value });
            return chain;
          },
          then(
            onF: (v: { data: null; error: unknown }) => unknown,
            onR?: (e: unknown) => unknown,
          ): Promise<unknown> {
            state.updates.push(rec);
            return Promise.resolve({ data: null, error: state.updateError }).then(
              onF,
              onR,
            );
          },
        };
        return chain;
      },
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  createRegisteredAgentAction,
  updateRegisteredAgentAction,
  deleteRegisteredAgentAction,
  createStateRegistrationAction,
  updateStateRegistrationAction,
  deleteStateRegistrationAction,
  createTaxRegistrationAction,
  updateTaxRegistrationAction,
  deleteTaxRegistrationAction,
} from "./registrations-actions";

function reset(): void {
  state.inserts = [];
  state.updates = [];
  state.insertError = null;
  state.updateError = null;
  mockValidateBusinessAccess.mockReset();
  mockValidateBusinessAccess.mockResolvedValue({
    userId: fakeUserId,
    role: "admin",
  });
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const agentForm = {
  business_id: "b-1",
  name: "Registered Agents LLC",
  address_line1: "100 Agent Way",
  city: "Dover",
  state: "de",
  postal_code: "19901",
};

describe("registered agents", () => {
  beforeEach(reset);

  it("create: inserts with upper-cased state and US default country", async () => {
    await createRegisteredAgentAction(fd(agentForm));
    expect(state.inserts[0]?.table).toBe("business_registered_agents");
    expect(state.inserts[0]?.rows).toMatchObject({
      business_id: "b-1",
      name: "Registered Agents LLC",
      state: "DE",
      country: "US",
      contact_email: null,
      notes: null,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business/b-1");
  });

  it("create: rejects a non-USPS state code before insert", async () => {
    await expect(
      createRegisteredAgentAction(fd({ ...agentForm, state: "Delaware" })),
    ).rejects.toThrow(/two-letter USPS code/);
    expect(state.inserts).toHaveLength(0);
  });

  it("create: member role is denied", async () => {
    mockValidateBusinessAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(createRegisteredAgentAction(fd(agentForm))).rejects.toThrow(
      /Only owners and admins/,
    );
    expect(state.inserts).toHaveLength(0);
  });

  it("update: scopes to agent id + business id and keeps explicit country", async () => {
    await updateRegisteredAgentAction(
      fd({ ...agentForm, agent_id: "a-7", country: "CA" }),
    );
    const u = state.updates[0];
    expect(u?.table).toBe("business_registered_agents");
    expect(u?.patch).toMatchObject({ state: "DE", country: "CA" });
    expect(u?.filters).toEqual([
      { col: "id", value: "a-7" },
      { col: "business_id", value: "b-1" },
    ]);
  });

  it("update: rejects when agent_id is missing", async () => {
    await expect(updateRegisteredAgentAction(fd(agentForm))).rejects.toThrow(
      /agent_id is required/,
    );
  });

  it("delete: soft-deletes via deleted_at, scoped to business", async () => {
    await deleteRegisteredAgentAction(
      fd({ business_id: "b-1", agent_id: "a-7" }),
    );
    const u = state.updates[0];
    expect(u?.patch.deleted_at).toEqual(expect.any(String));
    expect(u?.filters).toEqual([
      { col: "id", value: "a-7" },
      { col: "business_id", value: "b-1" },
    ]);
  });

  it("delete: denied for member role, no write issued", async () => {
    mockValidateBusinessAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      deleteRegisteredAgentAction(fd({ business_id: "b-1", agent_id: "a-7" })),
    ).rejects.toThrow(/Only owners and admins/);
    expect(state.updates).toHaveLength(0);
  });

  it("create: a failed insert propagates and skips revalidation", async () => {
    state.insertError = { message: "insert or update violates", code: "23503" };
    await expect(createRegisteredAgentAction(fd(agentForm))).rejects.toThrow();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("state registrations", () => {
  beforeEach(reset);

  const regForm = {
    business_id: "b-1",
    state: "tx",
    is_formation: "false",
    registration_status: "active",
  };

  it("create: derives registration_type from is_formation and defaults", async () => {
    await createStateRegistrationAction(fd(regForm));
    expect(state.inserts[0]?.table).toBe("business_state_registrations");
    expect(state.inserts[0]?.rows).toMatchObject({
      business_id: "b-1",
      state: "TX",
      is_formation: false,
      registration_type: "foreign_qualification",
      registration_status: "active",
    });
  });

  it("create: is_formation=true means a domestic registration", async () => {
    await createStateRegistrationAction(
      fd({ business_id: "b-1", state: "de", is_formation: "true" }),
    );
    expect(state.inserts[0]?.rows).toMatchObject({
      is_formation: true,
      registration_type: "domestic",
      // Omitted status defaults to pending.
      registration_status: "pending",
    });
  });

  it("create: invalid MM-DD annual report due date is rejected", async () => {
    await expect(
      createStateRegistrationAction(
        fd({ ...regForm, annual_report_due_mmdd: "13-40" }),
      ),
    ).rejects.toThrow(/Expected MM-DD/);
    expect(state.inserts).toHaveLength(0);
  });

  it("update: scopes to registration id + business id", async () => {
    await updateStateRegistrationAction(
      fd({ ...regForm, registration_id: "r-3" }),
    );
    expect(state.updates[0]?.filters).toEqual([
      { col: "id", value: "r-3" },
      { col: "business_id", value: "b-1" },
    ]);
  });

  it("delete: soft-deletes scoped to registration id + business id", async () => {
    await deleteStateRegistrationAction(
      fd({ business_id: "b-1", registration_id: "r-3" }),
    );
    const u = state.updates[0];
    expect(u?.table).toBe("business_state_registrations");
    expect(u?.patch.deleted_at).toEqual(expect.any(String));
    expect(u?.filters).toEqual([
      { col: "id", value: "r-3" },
      { col: "business_id", value: "b-1" },
    ]);
  });

  it("member role is denied for every state-registration mutation", async () => {
    mockValidateBusinessAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(createStateRegistrationAction(fd(regForm))).rejects.toThrow(
      /Only owners and admins/,
    );
    await expect(
      updateStateRegistrationAction(fd({ ...regForm, registration_id: "r-3" })),
    ).rejects.toThrow(/Only owners and admins/);
    await expect(
      deleteStateRegistrationAction(
        fd({ business_id: "b-1", registration_id: "r-3" }),
      ),
    ).rejects.toThrow(/Only owners and admins/);
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe("tax registrations", () => {
  beforeEach(reset);

  const taxForm = {
    business_id: "b-1",
    state: "wa",
    tax_type: "sales_use",
  };

  it("create: inserts with parsed fields and pending default status", async () => {
    await createTaxRegistrationAction(fd(taxForm));
    expect(state.inserts[0]?.table).toBe("business_tax_registrations");
    expect(state.inserts[0]?.rows).toMatchObject({
      business_id: "b-1",
      state: "WA",
      tax_type: "sales_use",
      tax_registration_status: "pending",
      permit_number: null,
    });
  });

  it("create: unknown tax_type is rejected before insert", async () => {
    await expect(
      createTaxRegistrationAction(fd({ ...taxForm, tax_type: "vibes_tax" })),
    ).rejects.toThrow(/Invalid tax_type/);
    expect(state.inserts).toHaveLength(0);
  });

  it("update: scopes to registration id + business id", async () => {
    await updateTaxRegistrationAction(
      fd({ ...taxForm, registration_id: "t-2", permit_number: "PN-1" }),
    );
    const u = state.updates[0];
    expect(u?.patch).toMatchObject({ permit_number: "PN-1" });
    expect(u?.filters).toEqual([
      { col: "id", value: "t-2" },
      { col: "business_id", value: "b-1" },
    ]);
  });

  it("delete: soft-deletes and revalidates", async () => {
    await deleteTaxRegistrationAction(
      fd({ business_id: "b-1", registration_id: "t-2" }),
    );
    expect(state.updates[0]?.patch.deleted_at).toEqual(expect.any(String));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business/b-1");
  });

  it("update: a failed write propagates (no silent success)", async () => {
    state.updateError = { message: "permission denied", code: "42501" };
    await expect(
      updateTaxRegistrationAction(fd({ ...taxForm, registration_id: "t-2" })),
    ).rejects.toThrow();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
