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
  /** Role returned by the user_customer_permission RPC.
   *  Defaults to "admin" so existing happy-path tests keep working
   *  after the SAL-pre-flight check landed; tests that exercise the
   *  refusal flip this to a non-admin role. */
  userCustomerPermissionRole: "admin" | "contributor" | "viewer" | null;
  deletes: { table: string; where: Record<string, string> }[];
  deleteError: { message: string } | null;
} = {
  rpcCalls: [],
  rpcError: null,
  userCustomerPermissionRole: "admin",
  deletes: [],
  deleteError: null,
};

function mockSupabase() {
  return {
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      if (name === "user_customer_permission") {
        return Promise.resolve({
          data: state.userCustomerPermissionRole,
          error: state.rpcError,
        });
      }
      return Promise.resolve({ data: null, error: state.rpcError });
    },
    from: (table: string) => ({
      delete: () => ({
        eq: (col: string, val: string) => {
          state.deletes.push({ table, where: { [col]: val } });
          return Promise.resolve({ data: null, error: state.deleteError });
        },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  grantPermissionAction,
  revokePermissionAction,
} from "./permissions-actions";

function resetState(): void {
  state.rpcCalls = [];
  state.rpcError = null;
  state.userCustomerPermissionRole = "admin";
  state.deletes = [];
  state.deleteError = null;
  mockRevalidatePath.mockReset();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("grantPermissionAction — combined principal field", () => {
  beforeEach(resetState);

  it("parses a 'user:<uuid>' principal into type=user + id=<uuid>", async () => {
    await grantPermissionAction(
      fd({
        customer_id: "c1",
        principal: "user:u-bob",
        permission_level: "viewer",
      }),
    );
    expect(state.rpcCalls).toEqual([
      {
        name: "grant_customer_permission",
        args: {
          p_customer_id: "c1",
          p_principal_type: "user",
          p_principal_id: "u-bob",
          p_level: "viewer",
        },
      },
    ]);
  });

  it("parses a 'group:<uuid>' principal into type=group + id=<uuid>", async () => {
    await grantPermissionAction(
      fd({
        customer_id: "c1",
        principal: "group:g-eng",
        permission_level: "contributor",
      }),
    );
    expect(state.rpcCalls[0]?.args).toMatchObject({
      p_principal_type: "group",
      p_principal_id: "g-eng",
      p_level: "contributor",
    });
  });

  it("rejects an unknown principal-type prefix (final type stays null → 'Principal type is required')", async () => {
    // "team:..." isn't a valid principal type — the parser sets type=null,
    // which trips the validation guard before the rpc fires.
    await expect(
      grantPermissionAction(
        fd({
          customer_id: "c1",
          principal: "team:t1",
          permission_level: "admin",
        }),
      ),
    ).rejects.toThrow(/Principal type is required/);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("grantPermissionAction — separate principal fields", () => {
  beforeEach(resetState);

  it("uses principal_type + principal_id when no combined field is sent", async () => {
    await grantPermissionAction(
      fd({
        customer_id: "c1",
        principal_type: "user",
        principal_id: "u-bob",
        permission_level: "admin",
      }),
    );
    expect(state.rpcCalls[0]?.args).toMatchObject({
      p_principal_type: "user",
      p_principal_id: "u-bob",
      p_level: "admin",
    });
  });

  it("combined principal field wins over separate fields when both are present", async () => {
    await grantPermissionAction(
      fd({
        customer_id: "c1",
        // Stale separate fields the form might keep around;
        // the combined `principal` value should override.
        principal_type: "group",
        principal_id: "g-stale",
        principal: "user:u-fresh",
        permission_level: "viewer",
      }),
    );
    expect(state.rpcCalls[0]?.args).toMatchObject({
      p_principal_type: "user",
      p_principal_id: "u-fresh",
    });
  });
});

describe("grantPermissionAction — validation guards", () => {
  beforeEach(resetState);

  it("rejects without customer_id", async () => {
    await expect(
      grantPermissionAction(
        fd({ principal: "user:u1", permission_level: "viewer" }),
      ),
    ).rejects.toThrow(/Client ID is required/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects without a principal at all", async () => {
    await expect(
      grantPermissionAction(
        fd({ customer_id: "c1", permission_level: "viewer" }),
      ),
    ).rejects.toThrow(/Principal type is required/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rejects without a permission_level", async () => {
    await expect(
      grantPermissionAction(
        fd({ customer_id: "c1", principal: "user:u1" }),
      ),
    ).rejects.toThrow(/Permission level is required/);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("propagates a Postgres error from the rpc", async () => {
    state.rpcError = { message: "duplicate principal" };
    await expect(
      grantPermissionAction(
        fd({
          customer_id: "c1",
          principal: "user:u1",
          permission_level: "viewer",
        }),
      ),
    ).rejects.toThrow(/duplicate principal/);
  });

  it("revalidates the customer page on success", async () => {
    await grantPermissionAction(
      fd({
        customer_id: "c1",
        principal: "user:u1",
        permission_level: "viewer",
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1");
  });
});

describe("revokePermissionAction", () => {
  beforeEach(resetState);

  it("deletes the permission by id when caller is a customer admin", async () => {
    await revokePermissionAction(
      fd({ permission_id: "perm1", customer_id: "c1" }),
    );
    expect(state.deletes).toEqual([
      { table: "customer_permissions", where: { id: "perm1" } },
    ]);
  });

  it("calls user_customer_permission as a pre-flight role check", async () => {
    await revokePermissionAction(
      fd({ permission_id: "perm1", customer_id: "c1" }),
    );
    expect(
      state.rpcCalls.some(
        (c) =>
          c.name === "user_customer_permission" &&
          (c.args as { p_customer_id: string }).p_customer_id === "c1",
      ),
    ).toBe(true);
  });

  it("refuses non-admin callers with a friendly error (no delete fires)", async () => {
    state.userCustomerPermissionRole = "contributor";
    await expect(
      revokePermissionAction(
        fd({ permission_id: "perm1", customer_id: "c1" }),
      ),
    ).rejects.toThrow(/customer admins/i);
    expect(state.deletes).toHaveLength(0);
  });

  it("rejects without permission_id (no delete)", async () => {
    await expect(
      revokePermissionAction(fd({ customer_id: "c1" })),
    ).rejects.toThrow(/Permission ID is required/);
    expect(state.deletes).toHaveLength(0);
  });

  it("rejects without customer_id (no delete)", async () => {
    await expect(
      revokePermissionAction(fd({ permission_id: "perm1" })),
    ).rejects.toThrow(/Customer ID is required/);
    expect(state.deletes).toHaveLength(0);
  });

  it("propagates a Postgres error from the delete", async () => {
    state.deleteError = { message: "permission denied" };
    await expect(
      revokePermissionAction(
        fd({ permission_id: "perm1", customer_id: "c1" }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("revalidates the customer page on success", async () => {
    await revokePermissionAction(
      fd({ permission_id: "perm1", customer_id: "c1" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/customers/c1");
  });
});
