import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeUserId = "u-admin";

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
  isTeamAdmin: (role: string) => role === "owner" || role === "admin",
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const state: {
  /** customers.maybeSingle result. */
  customerRow: { id: string; team_id: string } | null;
  customerError: { message: string } | null;
  /** customer_contacts load (maybeSingle) result. */
  contactRow: Record<string, unknown> | null;
  contactError: { message: string } | null;
  inserts: { table: string; rows: unknown }[];
  updates: { table: string; patch: Record<string, unknown>; where: [string, unknown][] }[];
  deletes: { table: string; where: [string, unknown][] }[];
} = {
  customerRow: { id: "c-1", team_id: "t-1" },
  customerError: null,
  contactRow: null,
  contactError: null,
  inserts: [],
  updates: [],
  deletes: [],
};

function mockSupabase() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table === "customers") {
              return Promise.resolve({
                data: state.customerRow,
                error: state.customerError,
              });
            }
            return Promise.resolve({
              data: state.contactRow,
              error: state.contactError,
            });
          },
        }),
      }),
      insert: (rows: unknown) => {
        state.inserts.push({ table, rows });
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          state.updates.push({ table, patch, where: [[col, val]] });
          return Promise.resolve({ data: null, error: null });
        },
      }),
      delete: () => ({
        eq: (col: string, val: unknown) => {
          state.deletes.push({ table, where: [[col, val]] });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  createCustomerContactAction,
  updateCustomerContactAction,
  deleteCustomerContactAction,
  setInvoiceRecipientAction,
} from "./contacts-actions";

function reset(): void {
  state.customerRow = { id: "c-1", team_id: "t-1" };
  state.customerError = null;
  state.contactRow = {
    id: "ct-1",
    customer_id: "c-1",
    team_id: "t-1",
    is_invoice_recipient: false,
  };
  state.contactError = null;
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
  mockValidateTeamAccess.mockReset();
  mockValidateTeamAccess.mockResolvedValue({
    userId: fakeUserId,
    role: "owner",
  });
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("createCustomerContactAction", () => {
  beforeEach(reset);

  it("inserts a contact scoped to the customer's team on the happy path", async () => {
    await createCustomerContactAction(
      fd({
        customer_id: "c-1",
        name: "Pat Payer",
        email: "ap@acme.test",
        role_label: "AP Manager",
        is_invoice_recipient: "true",
      }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe("customer_contacts");
    expect(state.inserts[0]?.rows).toEqual({
      team_id: "t-1",
      customer_id: "c-1",
      name: "Pat Payer",
      email: "ap@acme.test",
      role_label: "AP Manager",
      is_invoice_recipient: true,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c-1");
  });

  it("blank role_label becomes null; unchecked recipient flag becomes false", async () => {
    await createCustomerContactAction(
      fd({ customer_id: "c-1", name: "Pat", email: "p@a.io", role_label: "  " }),
    );
    expect(state.inserts[0]?.rows).toMatchObject({
      role_label: null,
      is_invoice_recipient: false,
    });
  });

  it("rejects a missing customer_id", async () => {
    await expect(
      createCustomerContactAction(fd({ name: "Pat", email: "p@a.io" })),
    ).rejects.toThrow(/customer_id is required/);
  });

  it("404s when the customer does not exist (or RLS hides it)", async () => {
    state.customerRow = null;
    await expect(
      createCustomerContactAction(
        fd({ customer_id: "c-x", name: "Pat", email: "p@a.io" }),
      ),
    ).rejects.toThrow(/Not found/);
    expect(state.inserts).toHaveLength(0);
  });

  it("denies plain members of the team", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      createCustomerContactAction(
        fd({ customer_id: "c-1", name: "Pat", email: "p@a.io" }),
      ),
    ).rejects.toThrow(/owners and admins/);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects a malformed email before insert", async () => {
    await expect(
      createCustomerContactAction(
        fd({ customer_id: "c-1", name: "Pat", email: "not-an-email" }),
      ),
    ).rejects.toThrow(/not a valid email address/);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects blank name / blank email", async () => {
    await expect(
      createCustomerContactAction(
        fd({ customer_id: "c-1", name: "  ", email: "p@a.io" }),
      ),
    ).rejects.toThrow(/Name is required/);
    await expect(
      createCustomerContactAction(
        fd({ customer_id: "c-1", name: "Pat", email: "" }),
      ),
    ).rejects.toThrow(/Email is required/);
  });
});

describe("updateCustomerContactAction", () => {
  beforeEach(reset);

  it("updates the contact by id and revalidates the owning customer page", async () => {
    await updateCustomerContactAction(
      fd({
        contact_id: "ct-1",
        name: "Pat Payer",
        email: "pat@acme.test",
        is_invoice_recipient: "true",
      }),
    );
    const u = state.updates.find((x) => x.table === "customer_contacts");
    expect(u?.patch).toEqual({
      name: "Pat Payer",
      email: "pat@acme.test",
      role_label: null,
      is_invoice_recipient: true,
    });
    expect(u?.where).toEqual([["id", "ct-1"]]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c-1");
  });

  it("404s when the contact does not exist", async () => {
    state.contactRow = null;
    await expect(
      updateCustomerContactAction(
        fd({ contact_id: "ct-x", name: "P", email: "p@a.io" }),
      ),
    ).rejects.toThrow(/Not found/);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects a missing contact_id", async () => {
    await expect(
      updateCustomerContactAction(fd({ name: "P", email: "p@a.io" })),
    ).rejects.toThrow(/contact_id is required/);
  });

  it("denies non-admins after resolving the contact's customer", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      updateCustomerContactAction(
        fd({ contact_id: "ct-1", name: "P", email: "p@a.io" }),
      ),
    ).rejects.toThrow(/owners and admins/);
    expect(state.updates).toHaveLength(0);
  });

  it("propagates a contact-load error instead of treating it as missing", async () => {
    state.contactRow = null;
    state.contactError = { message: "connection reset" };
    await expect(
      updateCustomerContactAction(
        fd({ contact_id: "ct-1", name: "P", email: "p@a.io" }),
      ),
    ).rejects.toThrow();
  });
});

describe("deleteCustomerContactAction", () => {
  beforeEach(reset);

  it("hard-deletes the contact row (contacts are not soft-deleted)", async () => {
    await deleteCustomerContactAction(fd({ contact_id: "ct-1" }));
    expect(state.deletes).toEqual([
      { table: "customer_contacts", where: [["id", "ct-1"]] },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c-1");
  });

  it("404s on an unknown contact and never issues a delete", async () => {
    state.contactRow = null;
    await expect(
      deleteCustomerContactAction(fd({ contact_id: "ct-x" })),
    ).rejects.toThrow(/Not found/);
    expect(state.deletes).toHaveLength(0);
  });

  it("denies plain members", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      deleteCustomerContactAction(fd({ contact_id: "ct-1" })),
    ).rejects.toThrow(/owners and admins/);
    expect(state.deletes).toHaveLength(0);
  });
});

describe("setInvoiceRecipientAction", () => {
  beforeEach(reset);

  it("toggles the flag from false to true", async () => {
    await setInvoiceRecipientAction(fd({ contact_id: "ct-1" }));
    const u = state.updates.find((x) => x.table === "customer_contacts");
    expect(u?.patch).toEqual({ is_invoice_recipient: true });
    expect(u?.where).toEqual([["id", "ct-1"]]);
  });

  it("toggles the flag from true to false (independent per contact)", async () => {
    state.contactRow = {
      id: "ct-1",
      customer_id: "c-1",
      team_id: "t-1",
      is_invoice_recipient: true,
    };
    await setInvoiceRecipientAction(fd({ contact_id: "ct-1" }));
    const u = state.updates.find((x) => x.table === "customer_contacts");
    expect(u?.patch).toEqual({ is_invoice_recipient: false });
  });

  it("rejects a missing contact_id", async () => {
    await expect(setInvoiceRecipientAction(fd({}))).rejects.toThrow(
      /contact_id is required/,
    );
  });

  it("denies plain members without writing", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      setInvoiceRecipientAction(fd({ contact_id: "ct-1" })),
    ).rejects.toThrow(/owners and admins/);
    expect(state.updates).toHaveLength(0);
  });
});
