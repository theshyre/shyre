import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeUserId = "u-hr-admin";

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
  op: string;
  col: string;
  value: unknown;
}

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const state: {
  user: { id: string } | null;
  inserts: { table: string; rows: unknown }[];
  updates: { table: string; patch: Record<string, unknown>; filters: Filter[] }[];
  /** Per-table result queues for awaited select chains. */
  queues: Record<string, Result[]>;
  /** Filters recorded per select chain, in call order. */
  selectFilters: { table: string; filters: Filter[] }[];
  insertError: { message: string; code?: string } | null;
} = {
  user: { id: fakeUserId },
  inserts: [],
  updates: [],
  queues: {},
  selectFilters: [],
  insertError: null,
};

function makeSelectChain(table: string): Record<string, unknown> {
  const filters: Filter[] = [];
  state.selectFilters.push({ table, filters });
  const resolve = (): Result =>
    state.queues[table]?.shift() ?? { data: [], error: null };
  const chain: Record<string, unknown> = {
    eq(col: string, value: unknown) {
      filters.push({ op: "eq", col, value });
      return chain;
    },
    gte(col: string, value: unknown) {
      filters.push({ op: "gte", col, value });
      return chain;
    },
    lte(col: string, value: unknown) {
      filters.push({ op: "lte", col, value });
      return chain;
    },
    in(col: string, value: unknown) {
      filters.push({ op: "in", col, value });
      return chain;
    },
    order() {
      return chain;
    },
    range(from: number, to: number) {
      filters.push({ op: "range", col: "", value: [from, to] });
      return chain;
    },
    then(
      onF: (v: Result) => unknown,
      onR?: (e: unknown) => unknown,
    ): Promise<unknown> {
      return Promise.resolve(resolve()).then(onF, onR);
    },
  };
  return chain;
}

function mockSupabase() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: state.user } }),
    },
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
            filters.push({ op: "eq", col, value });
            return chain;
          },
          then(
            onF: (v: Result) => unknown,
            onR?: (e: unknown) => unknown,
          ): Promise<unknown> {
            state.updates.push(rec);
            return Promise.resolve({ data: null, error: null }).then(onF, onR);
          },
        };
        return chain;
      },
      select: () => makeSelectChain(table),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

import {
  createPersonAction,
  updatePersonAction,
  deletePersonAction,
  getPersonHistoryAction,
  getBusinessPeopleHistoryAction,
} from "./people-actions";

function reset(): void {
  state.user = { id: fakeUserId };
  state.inserts = [];
  state.updates = [];
  state.queues = {};
  state.selectFilters = [];
  state.insertError = null;
  mockValidateBusinessAccess.mockReset();
  mockValidateBusinessAccess.mockResolvedValue({
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

const validPerson = {
  business_id: "b-1",
  legal_name: "Dana Fields",
  employment_type: "w2_employee",
};

describe("createPersonAction", () => {
  beforeEach(reset);

  it("inserts a business_people row with parsed fields on the happy path", async () => {
    await createPersonAction(
      fd({
        ...validPerson,
        preferred_name: "Dana",
        work_email: "dana@acme.test",
        compensation_amount: "95000.50",
        state: "ca",
      }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]?.table).toBe("business_people");
    expect(state.inserts[0]?.rows).toMatchObject({
      business_id: "b-1",
      legal_name: "Dana Fields",
      preferred_name: "Dana",
      work_email: "dana@acme.test",
      employment_type: "w2_employee",
      // Dollars → cents, rounded.
      compensation_amount_cents: 9500050,
      // Lower-case state normalizes to USPS upper-case.
      state: "CA",
    });
  });

  it("revalidates /business and /business/[id]", async () => {
    await createPersonAction(fd(validPerson));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business/b-1");
  });

  it("rejects a plain member of the business (authz denial) before any write", async () => {
    mockValidateBusinessAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(createPersonAction(fd(validPerson))).rejects.toThrow(
      /Only owners and admins/,
    );
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects a missing business_id before touching access control", async () => {
    await expect(
      createPersonAction(fd({ legal_name: "X", employment_type: "w2_employee" })),
    ).rejects.toThrow(/business_id is required/);
    expect(mockValidateBusinessAccess).not.toHaveBeenCalled();
  });

  it("rejects an invalid employment_type before insert", async () => {
    await expect(
      createPersonAction(
        fd({ ...validPerson, employment_type: "freeloader" }),
      ),
    ).rejects.toThrow(/Invalid employment_type/);
    expect(state.inserts).toHaveLength(0);
  });

  it("propagates a Supabase insert error as an AppError (no silent success)", async () => {
    state.insertError = { message: "duplicate key value", code: "23505" };
    await expect(createPersonAction(fd(validPerson))).rejects.toThrow();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("updatePersonAction", () => {
  beforeEach(reset);

  it("updates the row scoped to BOTH person id and business id", async () => {
    await updatePersonAction(
      fd({ ...validPerson, person_id: "p-9", title: "CFO" }),
    );
    const u = state.updates.find((x) => x.table === "business_people");
    expect(u?.patch).toMatchObject({ legal_name: "Dana Fields", title: "CFO" });
    expect(u?.filters).toEqual([
      { op: "eq", col: "id", value: "p-9" },
      { op: "eq", col: "business_id", value: "b-1" },
    ]);
  });

  it("rejects when person_id is missing", async () => {
    await expect(updatePersonAction(fd(validPerson))).rejects.toThrow(
      /person_id is required/,
    );
    expect(state.updates).toHaveLength(0);
  });

  it("rejects a plain member", async () => {
    mockValidateBusinessAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      updatePersonAction(fd({ ...validPerson, person_id: "p-9" })),
    ).rejects.toThrow(/Only owners and admins/);
    expect(state.updates).toHaveLength(0);
  });
});

describe("deletePersonAction", () => {
  beforeEach(reset);

  it("soft-deletes by stamping deleted_at (never a hard DELETE)", async () => {
    await deletePersonAction(fd({ business_id: "b-1", person_id: "p-9" }));
    const u = state.updates.find((x) => x.table === "business_people");
    expect(u?.patch.deleted_at).toEqual(expect.any(String));
    // Stamp is a parseable ISO timestamp.
    expect(
      Number.isNaN(new Date(u?.patch.deleted_at as string).getTime()),
    ).toBe(false);
    expect(u?.filters).toEqual([
      { op: "eq", col: "id", value: "p-9" },
      { op: "eq", col: "business_id", value: "b-1" },
    ]);
  });

  it("rejects an admin-of-nothing (member role)", async () => {
    mockValidateBusinessAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      deletePersonAction(fd({ business_id: "b-1", person_id: "p-9" })),
    ).rejects.toThrow(/Only owners and admins/);
    expect(state.updates).toHaveLength(0);
  });
});

describe("getPersonHistoryAction", () => {
  beforeEach(reset);

  it("throws Unauthorized when there is no session", async () => {
    state.user = null;
    await expect(getPersonHistoryAction("p-1")).rejects.toThrow(/Unauthorized/);
  });

  it("maps history rows and resolves actor display names", async () => {
    state.queues["business_people_history"] = [
      {
        data: [
          {
            id: "h-1",
            operation: "UPDATE",
            changed_at: "2026-07-01T10:00:00+00:00",
            changed_by_user_id: "u-a",
            previous_state: { title: "Analyst" },
          },
          {
            id: "h-2",
            operation: "DELETE",
            changed_at: "2026-06-01T10:00:00+00:00",
            changed_by_user_id: null,
            previous_state: null,
          },
        ],
        error: null,
      },
    ];
    state.queues["user_profiles"] = [
      { data: [{ user_id: "u-a", display_name: "Ana" }], error: null },
    ];

    const { history } = await getPersonHistoryAction("p-1");
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      id: "h-1",
      operation: "UPDATE",
      changedBy: { userId: "u-a", displayName: "Ana" },
      previousState: { title: "Analyst" },
    });
    // System / unknown actor + null previous_state degrade gracefully.
    expect(history[1]).toMatchObject({
      changedBy: { userId: null, displayName: null },
      previousState: {},
    });
    // The profile lookup was scoped to the distinct non-null actor ids.
    const profileFilters = state.selectFilters.find(
      (s) => s.table === "user_profiles",
    );
    expect(profileFilters?.filters).toEqual([
      { op: "in", col: "user_id", value: ["u-a"] },
    ]);
  });

  it("propagates a query error instead of returning an empty history", async () => {
    state.queues["business_people_history"] = [
      { data: null, error: { message: "permission denied", code: "42501" } },
    ];
    await expect(getPersonHistoryAction("p-1")).rejects.toThrow();
  });

  it("skips the profile lookup entirely when no rows have an actor", async () => {
    state.queues["business_people_history"] = [{ data: [], error: null }];
    const { history } = await getPersonHistoryAction("p-1");
    expect(history).toEqual([]);
    expect(
      state.selectFilters.filter((s) => s.table === "user_profiles"),
    ).toHaveLength(0);
  });
});

describe("getBusinessPeopleHistoryAction", () => {
  beforeEach(reset);

  const row = (
    id: string,
    personId: string,
    actor: string | null,
  ): Record<string, unknown> => ({
    id,
    business_person_id: personId,
    operation: "UPDATE",
    changed_at: "2026-07-01T10:00:00+00:00",
    changed_by_user_id: actor,
    previous_state: { legal_name: "Old Name" },
  });

  it("throws Unauthorized when there is no session", async () => {
    state.user = null;
    await expect(getBusinessPeopleHistoryAction("b-1")).rejects.toThrow(
      /Unauthorized/,
    );
  });

  it("returns hasMore=true and trims to the limit when limit+1 rows come back", async () => {
    state.queues["business_people_history"] = [
      { data: [row("h-1", "p-1", "u-a"), row("h-2", "p-1", "u-a")], error: null },
    ];
    state.queues["user_profiles"] = [
      { data: [{ user_id: "u-a", display_name: "Ana" }], error: null },
    ];
    state.queues["business_people"] = [
      {
        data: [{ id: "p-1", legal_name: "Dana Fields", preferred_name: "Dana" }],
        error: null,
      },
    ];

    const { history, hasMore } = await getBusinessPeopleHistoryAction("b-1", {
      limit: 1,
    });
    expect(hasMore).toBe(true);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      personId: "p-1",
      personDisplayName: "Dana",
      changedBy: { displayName: "Ana" },
    });
  });

  it("interprets a bare YYYY-MM-DD `to` filter as end-of-day inclusive", async () => {
    state.queues["business_people_history"] = [{ data: [], error: null }];
    await getBusinessPeopleHistoryAction("b-1", {
      from: "2026-06-01",
      to: "2026-06-30",
      personId: "p-1",
      actorUserId: "u-a",
    });
    const filters = state.selectFilters.find(
      (s) => s.table === "business_people_history",
    )?.filters;
    expect(filters).toContainEqual({
      op: "lte",
      col: "changed_at",
      value: "2026-06-30T23:59:59.999Z",
    });
    expect(filters).toContainEqual({
      op: "gte",
      col: "changed_at",
      value: "2026-06-01",
    });
    expect(filters).toContainEqual({
      op: "eq",
      col: "business_person_id",
      value: "p-1",
    });
    expect(filters).toContainEqual({
      op: "eq",
      col: "changed_by_user_id",
      value: "u-a",
    });
  });

  it("passes a full ISO `to` timestamp through unchanged", async () => {
    state.queues["business_people_history"] = [{ data: [], error: null }];
    await getBusinessPeopleHistoryAction("b-1", {
      to: "2026-06-30T12:00:00+00:00",
    });
    const filters = state.selectFilters.find(
      (s) => s.table === "business_people_history",
    )?.filters;
    expect(filters).toContainEqual({
      op: "lte",
      col: "changed_at",
      value: "2026-06-30T12:00:00+00:00",
    });
  });

  it("propagates a query error", async () => {
    state.queues["business_people_history"] = [
      { data: null, error: { message: "boom" } },
    ];
    await expect(getBusinessPeopleHistoryAction("b-1")).rejects.toThrow();
  });
});
