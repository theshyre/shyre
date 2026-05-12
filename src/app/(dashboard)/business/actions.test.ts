import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Action-layer tests for the business surface. Two destructive
 * actions:
 *
 *   - updateBusinessIdentityAction: role gate via validateBusinessAccess
 *     (not validateTeamAccess — business spans multiple teams; the
 *     highest role across any team in the business wins), entity_type
 *     allow-list, fiscal_year_start MM-DD regex, no-op short-circuit
 *     on the private table when nothing changed (bookkeeper finding #5).
 *
 *   - deleteBusinessAction: layered refusals — must own EVERY team in
 *     the business, must own at least one OTHER business (refuse to
 *     orphan), typed-name confirm matches legal_name OR seeded name.
 *     Then cascades teams + business with revalidate + redirect.
 *
 * getBusinessIdentityHistoryAction (read-only history merge) is
 * intentionally out of scope here — the merge helper has its own tests.
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

const mockValidateBusinessAccess = vi.fn();
vi.mock("@/lib/team-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/team-context")>(
    "@/lib/team-context",
  );
  return {
    ...actual,
    validateBusinessAccess: (id: string) => mockValidateBusinessAccess(id),
  };
});

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

const mockRedirect = vi.fn((path: string): never => {
  const err = new Error(`NEXT_REDIRECT ${path}`) as Error & {
    digest: string;
  };
  err.digest = `NEXT_REDIRECT;replace;${path};307;`;
  throw err;
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

interface Filter {
  col: string;
  op: string;
  value: unknown;
}

const state: {
  authUser: { id: string } | null;
  business: { id: string; name: string | null; legal_name: string | null } | null;
  teamsInBiz: Array<{ id: string }>;
  callerMemberships: Array<{ team_id: string; role: string }>;
  otherOwnerships: Array<{
    teams: { id: string; business_id: string | null };
  }>;
  /** What businessRow.maybeSingle on business_identity_private returns. */
  existingPrivate:
    | {
        tax_id: string | null;
        date_incorporated: string | null;
        fiscal_year_start: string | null;
      }
    | null;
  updates: { table: string; patch: unknown; filters: Filter[] }[];
  deletes: { table: string; filters: Filter[] }[];
  updateError: { message: string } | null;
} = {
  authUser: { id: fakeUserId },
  business: null,
  teamsInBiz: [],
  callerMemberships: [],
  otherOwnerships: [],
  existingPrivate: null,
  updates: [],
  deletes: [],
  updateError: null,
};

function mockSupabase() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: state.authUser },
          error: null,
        }),
    },
    from: (table: string) => tableChain(table),
  };
}

function tableChain(table: string) {
  type Op =
    | { kind: "select"; cols: string }
    | { kind: "update"; patch: unknown }
    | { kind: "delete" };
  const op: { current: Op | null; filters: Filter[] } = {
    current: null,
    filters: [],
  };
  const chain: Record<string, unknown> = {
    select(cols: string) {
      op.current = { kind: "select", cols };
      return chain;
    },
    update(patch: unknown) {
      op.current = { kind: "update", patch };
      return chain;
    },
    delete() {
      op.current = { kind: "delete" };
      return chain;
    },
    eq(col: string, value: unknown) {
      op.filters.push({ col, op: "eq", value });
      return chain;
    },
    in(col: string, value: unknown) {
      op.filters.push({ col, op: "in", value });
      return chain;
    },
    maybeSingle() {
      if (table === "businesses") {
        return Promise.resolve({ data: state.business, error: null });
      }
      if (table === "business_identity_private") {
        return Promise.resolve({
          data: state.existingPrivate,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (v: { data: unknown; error: unknown }) => void) {
      if (op.current?.kind === "update") {
        state.updates.push({
          table,
          patch: op.current.patch,
          filters: [...op.filters],
        });
        resolve({ data: null, error: state.updateError });
        return;
      }
      if (op.current?.kind === "delete") {
        state.deletes.push({ table, filters: [...op.filters] });
        resolve({ data: null, error: state.updateError });
        return;
      }
      // select() — return list-shaped data per table.
      if (table === "teams") {
        resolve({ data: state.teamsInBiz, error: null });
        return;
      }
      if (table === "team_members") {
        // Distinguish the two select patterns by inspecting filters.
        const filteringByUserId = op.filters.some((f) => f.col === "user_id");
        const filteringByRoleOwner = op.filters.some(
          (f) => f.col === "role" && f.value === "owner",
        );
        const filteringByTeamIn = op.filters.some(
          (f) => f.col === "team_id" && f.op === "in",
        );
        if (filteringByUserId && filteringByTeamIn) {
          resolve({ data: state.callerMemberships, error: null });
          return;
        }
        if (filteringByUserId && filteringByRoleOwner) {
          resolve({ data: state.otherOwnerships, error: null });
          return;
        }
      }
      resolve({ data: null, error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  deleteBusinessAction,
  updateBusinessIdentityAction,
} from "./actions";

function reset(): void {
  state.authUser = { id: fakeUserId };
  state.business = null;
  state.teamsInBiz = [];
  state.callerMemberships = [];
  state.otherOwnerships = [];
  state.existingPrivate = null;
  state.updates = [];
  state.deletes = [];
  state.updateError = null;
  mockValidateBusinessAccess.mockReset();
  mockRevalidatePath.mockReset();
  mockRedirect.mockClear();
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("updateBusinessIdentityAction", () => {
  beforeEach(reset);

  it("rejects missing business_id", async () => {
    await expect(
      updateBusinessIdentityAction(fd({})),
    ).rejects.toThrow(/business_id/);
  });

  it("rejects plain members of the business", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "member" });
    await expect(
      updateBusinessIdentityAction(fd({ business_id: "b-1" })),
    ).rejects.toThrow(/owners and admins/);
  });

  it("admin can update (not only owner)", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "admin" });
    await updateBusinessIdentityAction(
      fd({ business_id: "b-1", legal_name: "Acme LLC" }),
    );
    // businesses table updated with the public fields.
    const businessUpdate = state.updates.find((u) => u.table === "businesses");
    expect(businessUpdate?.patch).toEqual({
      legal_name: "Acme LLC",
      entity_type: null,
    });
  });

  it("rejects an entity_type outside the allow-list", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "owner" });
    await expect(
      updateBusinessIdentityAction(
        fd({
          business_id: "b-1",
          entity_type: "intergalactic_holding_co",
        }),
      ),
    ).rejects.toThrow(/Invalid entity_type/);
    expect(state.updates).toHaveLength(0);
  });

  it("validates fiscal_year_start MM-DD format strictly", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "owner" });
    await expect(
      updateBusinessIdentityAction(
        fd({ business_id: "b-1", fiscal_year_start: "13-01" }),
      ),
    ).rejects.toThrow(/MM-DD/);
    await expect(
      updateBusinessIdentityAction(
        fd({ business_id: "b-1", fiscal_year_start: "01-32" }),
      ),
    ).rejects.toThrow(/MM-DD/);
    await expect(
      updateBusinessIdentityAction(
        fd({ business_id: "b-1", fiscal_year_start: "January 1" }),
      ),
    ).rejects.toThrow(/MM-DD/);
  });

  it("accepts a well-formed MM-DD fiscal_year_start", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "owner" });
    state.existingPrivate = null; // ensure privateChanged path fires
    await updateBusinessIdentityAction(
      fd({ business_id: "b-1", fiscal_year_start: "07-01" }),
    );
    const pvtUpdate = state.updates.find(
      (u) => u.table === "business_identity_private",
    );
    expect((pvtUpdate?.patch as Record<string, unknown>).fiscal_year_start).toBe(
      "07-01",
    );
  });

  it("skips the private-table UPDATE when nothing changed (bookkeeper finding #5)", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "owner" });
    state.existingPrivate = {
      tax_id: "12-3456789",
      date_incorporated: "2020-01-01",
      fiscal_year_start: "01-01",
    };
    await updateBusinessIdentityAction(
      fd({
        business_id: "b-1",
        tax_id: "12-3456789",
        date_incorporated: "2020-01-01",
        fiscal_year_start: "01-01",
      }),
    );
    expect(
      state.updates.find((u) => u.table === "business_identity_private"),
    ).toBeUndefined();
    // But the businesses table IS still updated (legal_name / entity_type
    // are display fields and write unconditionally — that's fine).
    expect(state.updates.find((u) => u.table === "businesses")).toBeDefined();
  });

  it("DOES write the private table when at least one private field differs", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "owner" });
    state.existingPrivate = {
      tax_id: "old-tax-id",
      date_incorporated: "2020-01-01",
      fiscal_year_start: "01-01",
    };
    await updateBusinessIdentityAction(
      fd({
        business_id: "b-1",
        tax_id: "new-tax-id",
        date_incorporated: "2020-01-01",
        fiscal_year_start: "01-01",
      }),
    );
    expect(
      state.updates.find((u) => u.table === "business_identity_private"),
    ).toBeDefined();
  });

  it("revalidates /business and /business/<id> on success", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "owner" });
    await updateBusinessIdentityAction(
      fd({ business_id: "b-1", legal_name: "Acme" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business/b-1");
  });

  it("blank legal_name / entity_type normalize to null", async () => {
    mockValidateBusinessAccess.mockResolvedValue({ role: "owner" });
    await updateBusinessIdentityAction(
      fd({ business_id: "b-1", legal_name: "   ", entity_type: "" }),
    );
    const businessUpdate = state.updates.find((u) => u.table === "businesses");
    expect(businessUpdate?.patch).toEqual({
      legal_name: null,
      entity_type: null,
    });
  });
});

describe("deleteBusinessAction", () => {
  beforeEach(reset);

  it("rejects missing business_id", async () => {
    await expect(deleteBusinessAction(fd({}))).rejects.toThrow(
      /business_id/,
    );
  });

  it("rejects unauthenticated callers", async () => {
    state.authUser = null;
    await expect(
      deleteBusinessAction(fd({ business_id: "b-1" })),
    ).rejects.toThrow(/Unauthorized/);
  });

  it("rejects when the business isn't found / RLS-hidden", async () => {
    state.business = null;
    await expect(
      deleteBusinessAction(fd({ business_id: "b-nope" })),
    ).rejects.toThrow(/not found|access denied/i);
  });

  it("rejects when the business has no teams (data-shape sanity)", async () => {
    state.business = { id: "b-1", name: "Acme", legal_name: null };
    state.teamsInBiz = [];
    await expect(
      deleteBusinessAction(fd({ business_id: "b-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/no teams/);
  });

  it("rejects when the caller is not owner of EVERY team in the business", async () => {
    state.business = { id: "b-1", name: "Acme", legal_name: null };
    state.teamsInBiz = [{ id: "t-a" }, { id: "t-b" }];
    // Only owner of one team; member on the other.
    state.callerMemberships = [
      { team_id: "t-a", role: "owner" },
      { team_id: "t-b", role: "member" },
    ];
    await expect(
      deleteBusinessAction(fd({ business_id: "b-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/owner of every team/);
    expect(state.deletes).toHaveLength(0);
  });

  it("rejects when the caller owns no OTHER business (refuse-to-orphan check)", async () => {
    state.business = { id: "b-1", name: "Acme", legal_name: null };
    state.teamsInBiz = [{ id: "t-a" }];
    state.callerMemberships = [{ team_id: "t-a", role: "owner" }];
    // Only owner of teams within b-1 (no others).
    state.otherOwnerships = [
      { teams: { id: "t-a", business_id: "b-1" } },
    ];
    await expect(
      deleteBusinessAction(fd({ business_id: "b-1", confirm_name: "Acme" })),
    ).rejects.toThrow(/only business|create another/i);
  });

  it("rejects when typed-confirm doesn't match the legal_name", async () => {
    state.business = {
      id: "b-1",
      name: "Acme Co",
      legal_name: "Acme LLC",
    };
    state.teamsInBiz = [{ id: "t-a" }];
    state.callerMemberships = [{ team_id: "t-a", role: "owner" }];
    state.otherOwnerships = [
      { teams: { id: "t-a", business_id: "b-1" } },
      { teams: { id: "t-other", business_id: "b-2" } },
    ];
    await expect(
      deleteBusinessAction(
        // Typed `Acme Co` (the seeded name), but legal_name is "Acme LLC"
        // and legal_name wins the expected-confirm chain.
        fd({ business_id: "b-1", confirm_name: "Acme Co" }),
      ),
    ).rejects.toThrow(/does not match/);
  });

  it("falls back to seeded `name` when legal_name is null and matches confirm", async () => {
    state.business = {
      id: "b-1",
      name: "Acme Co",
      legal_name: null,
    };
    state.teamsInBiz = [{ id: "t-a" }];
    state.callerMemberships = [{ team_id: "t-a", role: "owner" }];
    state.otherOwnerships = [
      { teams: { id: "t-a", business_id: "b-1" } },
      { teams: { id: "t-other", business_id: "b-2" } },
    ];
    await expect(
      deleteBusinessAction(
        fd({ business_id: "b-1", confirm_name: "Acme Co" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    // Teams deleted first, then business.
    expect(state.deletes.map((d) => d.table)).toEqual([
      "teams",
      "businesses",
    ]);
  });

  it("happy path cascades teams then business and redirects to /business", async () => {
    state.business = { id: "b-1", name: "Acme", legal_name: "Acme LLC" };
    state.teamsInBiz = [{ id: "t-a" }, { id: "t-b" }];
    state.callerMemberships = [
      { team_id: "t-a", role: "owner" },
      { team_id: "t-b", role: "owner" },
    ];
    state.otherOwnerships = [
      { teams: { id: "t-a", business_id: "b-1" } },
      { teams: { id: "t-b", business_id: "b-1" } },
      { teams: { id: "t-other", business_id: "b-2" } },
    ];
    await expect(
      deleteBusinessAction(
        fd({ business_id: "b-1", confirm_name: "Acme LLC" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    // Both teams deleted, then the business.
    expect(state.deletes).toHaveLength(3);
    expect(state.deletes[0]?.table).toBe("teams");
    expect(state.deletes[1]?.table).toBe("teams");
    expect(state.deletes[2]?.table).toBe("businesses");
    expect(mockRedirect).toHaveBeenCalledWith("/business");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/teams");
  });
});
