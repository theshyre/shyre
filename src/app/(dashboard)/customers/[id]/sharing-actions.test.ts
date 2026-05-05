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

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const state: {
  rpcCalls: { name: string; args: unknown }[];
  rpcError: { message: string } | null;
  deletes: { table: string; where: Record<string, string> }[];
  deleteError: { message: string } | null;
  updates: {
    table: string;
    patch: Record<string, unknown>;
    where: Record<string, string>;
  }[];
  updateError: { message: string } | null;
} = {
  rpcCalls: [],
  rpcError: null,
  deletes: [],
  deleteError: null,
  updates: [],
  updateError: null,
};

function mockSupabase() {
  return {
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({
        data: null,
        error: state.rpcError,
      });
    },
    from: (table: string) => ({
      delete: () => ({
        eq: (col: string, val: string) => {
          state.deletes.push({ table, where: { [col]: val } });
          return Promise.resolve({ data: null, error: state.deleteError });
        },
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          state.updates.push({ table, patch, where: { [col]: val } });
          return Promise.resolve({ data: null, error: state.updateError });
        },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  addCustomerShareAction,
  removeCustomerShareAction,
  updateShareVisibilityAction,
} from "./sharing-actions";

function resetState(): void {
  state.rpcCalls = [];
  state.rpcError = null;
  state.deletes = [];
  state.deleteError = null;
  state.updates = [];
  state.updateError = null;
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("addCustomerShareAction", () => {
  beforeEach(resetState);

  it("calls add_customer_share rpc with the submitted args", async () => {
    await addCustomerShareAction(
      fd({
        customer_id: "c1",
        team_id: "t1",
        can_see_others: "on",
      }),
    );
    expect(state.rpcCalls).toEqual([
      {
        name: "add_customer_share",
        args: {
          p_customer_id: "c1",
          p_team_id: "t1",
          p_can_see_others: true,
        },
      },
    ]);
  });

  it("translates an unchecked can_see_others to false", async () => {
    await addCustomerShareAction(
      fd({ customer_id: "c1", team_id: "t1" }),
    );
    expect(state.rpcCalls[0]?.args).toMatchObject({ p_can_see_others: false });
  });

  it("rejects without a customer_id (no rpc call)", async () => {
    await expect(
      addCustomerShareAction(fd({ team_id: "t1" })),
    ).rejects.toThrow(/Client ID is required/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects without a team_id (no rpc call)", async () => {
    await expect(
      addCustomerShareAction(fd({ customer_id: "c1" })),
    ).rejects.toThrow(/Team is required/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("propagates a Postgres error from the rpc as a thrown error", async () => {
    state.rpcError = {
      message: "permission denied for relation customer_shares",
    };
    await expect(
      addCustomerShareAction(
        fd({ customer_id: "c1", team_id: "t1" }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("revalidates the customer page on success", async () => {
    await addCustomerShareAction(
      fd({ customer_id: "c1", team_id: "t1" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1");
  });
});

describe("removeCustomerShareAction", () => {
  beforeEach(resetState);

  it("deletes the share by id", async () => {
    await removeCustomerShareAction(
      fd({ share_id: "s1", customer_id: "c1" }),
    );
    expect(state.deletes).toEqual([
      { table: "customer_shares", where: { id: "s1" } },
    ]);
  });

  it("rejects without a share_id (no delete)", async () => {
    await expect(
      removeCustomerShareAction(fd({ customer_id: "c1" })),
    ).rejects.toThrow(/Share ID is required/);
    expect(state.deletes).toHaveLength(0);
  });

  it("propagates a Postgres error from the delete", async () => {
    state.deleteError = { message: "FK violation: child row exists" };
    await expect(
      removeCustomerShareAction(
        fd({ share_id: "s1", customer_id: "c1" }),
      ),
    ).rejects.toThrow(/FK violation/);
  });

  it("revalidates the customer page on success", async () => {
    await removeCustomerShareAction(
      fd({ share_id: "s1", customer_id: "c1" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1");
  });
});

describe("updateShareVisibilityAction", () => {
  beforeEach(resetState);

  it("updates can_see_others_entries=true when checkbox is on", async () => {
    await updateShareVisibilityAction(
      fd({ share_id: "s1", customer_id: "c1", can_see_others: "on" }),
    );
    const u = state.updates.find((x) => x.table === "customer_shares");
    expect(u?.patch).toEqual({ can_see_others_entries: true });
    expect(u?.where).toEqual({ id: "s1" });
  });

  it("updates can_see_others_entries=false when checkbox is absent", async () => {
    await updateShareVisibilityAction(
      fd({ share_id: "s1", customer_id: "c1" }),
    );
    const u = state.updates.find((x) => x.table === "customer_shares");
    expect(u?.patch).toEqual({ can_see_others_entries: false });
  });

  it("rejects without a share_id (no update)", async () => {
    await expect(
      updateShareVisibilityAction(fd({ customer_id: "c1" })),
    ).rejects.toThrow(/Share ID is required/);
    expect(state.updates).toHaveLength(0);
  });

  it("propagates a Postgres error", async () => {
    state.updateError = { message: "permission denied" };
    await expect(
      updateShareVisibilityAction(
        fd({ share_id: "s1", customer_id: "c1" }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("revalidates the customer page on success", async () => {
    await updateShareVisibilityAction(
      fd({ share_id: "s1", customer_id: "c1" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1");
  });
});
