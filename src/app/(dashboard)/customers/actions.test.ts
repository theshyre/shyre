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
  validateTeamAccess: (...args: unknown[]) => mockValidateTeamAccess(...args),
  isTeamAdmin: (role: string) => role === "owner" || role === "admin",
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const state: {
  canSetCustomerRate: boolean;
  customerRow: Record<string, unknown> | null;
  inserts: { table: string; rows: unknown }[];
  updates: {
    table: string;
    patch: Record<string, unknown>;
    where: Record<string, string>;
  }[];
  rpcCalls: { name: string; args: unknown }[];
} = {
  canSetCustomerRate: true,
  customerRow: { id: "c1", team_id: "t-1" },
  inserts: [],
  updates: [],
  rpcCalls: [],
};

function mockSupabase() {
  return {
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({
        data: name === "can_set_customer_rate" ? state.canSetCustomerRate : null,
        error: null,
      });
    },
    from: (table: string) => ({
      insert: (rows: unknown) => {
        state.inserts.push({ table, rows });
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          state.updates.push({ table, patch, where: { [col]: val } });
          return Promise.resolve({ data: null, error: null });
        },
      }),
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: state.customerRow, error: null }),
        }),
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  createCustomerAction,
  updateCustomerAction,
  setCustomerRateAction,
  setCustomerLogoAction,
  archiveCustomerAction,
} from "./actions";

function resetState(): void {
  state.canSetCustomerRate = true;
  state.customerRow = { id: "c1", team_id: "t-1" };
  state.inserts = [];
  state.updates = [];
  state.rpcCalls = [];
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createCustomerAction", () => {
  beforeEach(resetState);

  it("inserts a customer with name + team + user, defaulting optional fields to null", async () => {
    await createCustomerAction(
      fd({ team_id: "t1", name: "Acme Inc" }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe("customers");
    expect(state.inserts[0]?.rows).toMatchObject({
      team_id: "t1",
      user_id: fakeUserId,
      name: "Acme Inc",
      email: null,
      address: null,
      notes: null,
      default_rate: null,
    });
  });

  it("validates team access against the submitted team_id", async () => {
    await createCustomerAction(fd({ team_id: "t1", name: "Acme" }));
    expect(mockValidateTeamAccess).toHaveBeenCalledWith("t1");
  });

  it("revalidates /customers on success", async () => {
    await createCustomerAction(fd({ team_id: "t1", name: "Acme" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("parses default_rate as a float", async () => {
    await createCustomerAction(
      fd({ team_id: "t1", name: "Acme", default_rate: "175.50" }),
    );
    const rows = state.inserts[0]?.rows as Record<string, unknown>;
    expect(rows.default_rate).toBe(175.5);
  });

  it("treats blank default_rate as null", async () => {
    await createCustomerAction(
      fd({ team_id: "t1", name: "Acme", default_rate: "" }),
    );
    const rows = state.inserts[0]?.rows as Record<string, unknown>;
    expect(rows.default_rate).toBeNull();
  });

  it("serializes a populated address into JSON", async () => {
    await createCustomerAction(
      fd({
        team_id: "t1",
        name: "Acme",
        "address.street": "100 Main St",
        "address.city": "Sometown",
        "address.state": "CA",
        "address.postalCode": "94000",
        "address.country": "US",
      }),
    );
    const rows = state.inserts[0]?.rows as Record<string, unknown>;
    expect(rows.address).toBe(
      JSON.stringify({
        street: "100 Main St",
        street2: "",
        city: "Sometown",
        state: "CA",
        postalCode: "94000",
        country: "US",
      }),
    );
  });

  it("returns null for an entirely blank address (every field empty)", async () => {
    await createCustomerAction(
      fd({ team_id: "t1", name: "Acme", "address.street": "" }),
    );
    const rows = state.inserts[0]?.rows as Record<string, unknown>;
    expect(rows.address).toBeNull();
  });
});

describe("updateCustomerAction", () => {
  beforeEach(resetState);

  it("updates name + email + notes scoped to id", async () => {
    await updateCustomerAction(
      fd({
        id: "c1",
        name: "Acme",
        email: "billing@acme.test",
        notes: "Net-30",
      }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.where).toEqual({ id: "c1" });
    expect(u?.patch).toMatchObject({
      name: "Acme",
      email: "billing@acme.test",
      notes: "Net-30",
    });
  });

  it("treats unchecked show_country_on_invoice as false (checkbox absent from form)", async () => {
    await updateCustomerAction(fd({ id: "c1", name: "Acme" }));
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch.show_country_on_invoice).toBe(false);
  });

  it("persists a valid accent_color; empty clears it to null", async () => {
    await updateCustomerAction(fd({ id: "c1", name: "Acme", accent_color: "#2563EB" }));
    expect(
      state.updates.find((x) => x.table === "customers")?.patch.accent_color,
    ).toBe("#2563EB");
    resetState();
    await updateCustomerAction(fd({ id: "c1", name: "Acme", accent_color: "" }));
    expect(
      state.updates.find((x) => x.table === "customers")?.patch.accent_color,
    ).toBeNull();
  });

  it("rejects a malformed accent_color with a friendly message (before the update)", async () => {
    await expect(
      updateCustomerAction(fd({ id: "c1", name: "Acme", accent_color: "blue" })),
    ).rejects.toThrow(/hex value/);
    expect(state.updates).toHaveLength(0);
  });

  it("treats checked show_country_on_invoice as true", async () => {
    await updateCustomerAction(
      fd({ id: "c1", name: "Acme", show_country_on_invoice: "on" }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch.show_country_on_invoice).toBe(true);
  });

  it("payment_terms_days: empty string maps to null (inherit team default)", async () => {
    await updateCustomerAction(
      fd({ id: "c1", name: "Acme", payment_terms_days: "" }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch.payment_terms_days).toBeNull();
  });

  it("payment_terms_days: parses an integer in range", async () => {
    await updateCustomerAction(
      fd({ id: "c1", name: "Acme", payment_terms_days: "30" }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch.payment_terms_days).toBe(30);
  });

  it("payment_terms_days: clamps a value above 365 to 365", async () => {
    await updateCustomerAction(
      fd({ id: "c1", name: "Acme", payment_terms_days: "9999" }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch.payment_terms_days).toBe(365);
  });

  it("payment_terms_days: clamps a negative value to 0", async () => {
    await updateCustomerAction(
      fd({ id: "c1", name: "Acme", payment_terms_days: "-7" }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch.payment_terms_days).toBe(0);
  });

  it("payment_terms_days: omitting the field leaves it absent from the patch (no override)", async () => {
    await updateCustomerAction(fd({ id: "c1", name: "Acme" }));
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch).not.toHaveProperty("payment_terms_days");
  });

  it("default_rate: included in the patch when can_set_customer_rate is true", async () => {
    state.canSetCustomerRate = true;
    await updateCustomerAction(
      fd({ id: "c1", name: "Acme", default_rate: "200" }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch.default_rate).toBe(200);
  });

  it("default_rate: silently dropped when can_set_customer_rate is false", async () => {
    state.canSetCustomerRate = false;
    await updateCustomerAction(
      fd({ id: "c1", name: "Acme", default_rate: "999" }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch).not.toHaveProperty("default_rate");
    // Other fields persist.
    expect(u?.patch.name).toBe("Acme");
  });

  it("default_rate: skips the rpc check entirely when the field is absent", async () => {
    await updateCustomerAction(fd({ id: "c1", name: "Acme" }));
    const calls = state.rpcCalls.filter(
      (c) => c.name === "can_set_customer_rate",
    );
    expect(calls).toHaveLength(0);
  });

  it("revalidates both /customers and /customers/[id] on success", async () => {
    await updateCustomerAction(fd({ id: "c1", name: "Acme" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1");
  });
});

describe("setCustomerLogoAction", () => {
  const SUPA = "https://proj.supabase.co";
  const ownLogo = (team: string) =>
    `${SUPA}/storage/v1/object/public/branding/${team}/customers/c1/1.png`;

  beforeEach(() => {
    resetState();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
  });

  it("persists a valid own-branding customer logo (owner/admin)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "admin" });
    await setCustomerLogoAction(
      fd({ customer_id: "c1", logo_url: ownLogo("t-1") }),
    );
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.where).toEqual({ id: "c1" });
    expect(u?.patch).toEqual({ logo_url: ownLogo("t-1") });
  });

  it("rejects a plain member", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "member" });
    await expect(
      setCustomerLogoAction(fd({ customer_id: "c1", logo_url: ownLogo("t-1") })),
    ).rejects.toThrow(/owners and admins/);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects an off-site / foreign-team URL (SAL-041)", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await expect(
      setCustomerLogoAction(
        fd({ customer_id: "c1", logo_url: "https://evil.example/x.png" }),
      ),
    ).rejects.toThrow(/not a valid upload/);
    await expect(
      setCustomerLogoAction(fd({ customer_id: "c1", logo_url: ownLogo("t-9") })),
    ).rejects.toThrow(/not a valid upload/);
    expect(state.updates).toHaveLength(0);
  });

  it("clears the logo (null) on the remove path", async () => {
    mockValidateTeamAccess.mockResolvedValue({ userId: fakeUserId, role: "owner" });
    await setCustomerLogoAction(fd({ customer_id: "c1" }));
    expect(
      state.updates.find((x) => x.table === "customers")?.patch,
    ).toEqual({ logo_url: null });
  });
});

describe("setCustomerRateAction", () => {
  beforeEach(resetState);

  it("writes the rate when can_set_customer_rate is true", async () => {
    state.canSetCustomerRate = true;
    await setCustomerRateAction(fd({ id: "c1", default_rate: "250" }));
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch).toEqual({ default_rate: 250 });
    expect(u?.where).toEqual({ id: "c1" });
  });

  it("writes null when default_rate is absent (clears the rate)", async () => {
    state.canSetCustomerRate = true;
    await setCustomerRateAction(fd({ id: "c1" }));
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch).toEqual({ default_rate: null });
  });

  it("throws when can_set_customer_rate returns false and does not write", async () => {
    state.canSetCustomerRate = false;
    await expect(
      setCustomerRateAction(fd({ id: "c1", default_rate: "999" })),
    ).rejects.toThrow(/Not authorized to set this customer's rate/);
    expect(state.updates).toHaveLength(0);
  });

  it("throws when id is missing", async () => {
    await expect(
      setCustomerRateAction(fd({ default_rate: "100" })),
    ).rejects.toThrow(/Customer id is required/);
    expect(state.updates).toHaveLength(0);
    // Should fail before the RPC permission check fires.
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("revalidates /customers and /customers/[id]", async () => {
    await setCustomerRateAction(fd({ id: "c1", default_rate: "100" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1");
  });
});

describe("archiveCustomerAction", () => {
  beforeEach(resetState);

  it("sets archived=true on the addressed customer", async () => {
    await archiveCustomerAction(fd({ id: "c1" }));
    const u = state.updates.find((x) => x.table === "customers");
    expect(u?.patch).toEqual({ archived: true });
    expect(u?.where).toEqual({ id: "c1" });
  });

  it("revalidates /customers", async () => {
    await archiveCustomerAction(fd({ id: "c1" }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers");
  });
});
