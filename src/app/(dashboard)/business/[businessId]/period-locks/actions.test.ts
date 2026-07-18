import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock runSafeAction to strip the auth boundary.
// safe-action.test.ts covers the wrapper; here we test the inside:
// validation, the owner/admin gate, and the writes.
const fakeUserId = "u-locker";
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
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

interface SupaError {
  message: string;
  code?: string;
}

const state: {
  inserts: { table: string; rows: unknown }[];
  deletes: { table: string; where: Record<string, string> }[];
  insertError: SupaError | null;
  deleteError: SupaError | null;
} = {
  inserts: [],
  deletes: [],
  insertError: null,
  deleteError: null,
};

interface DeleteChain {
  eq: (col: string, val: string) => DeleteChain;
  then: <T>(
    onFulfilled: (v: { data: null; error: SupaError | null }) => T,
    onRejected?: (e: unknown) => T,
  ) => Promise<T>;
}

function mockSupabase() {
  return {
    from: (table: string) => ({
      insert: (rows: unknown) => {
        state.inserts.push({ table, rows });
        return Promise.resolve({ data: null, error: state.insertError });
      },
      delete: () => {
        const where: Record<string, string> = {};
        const chain: DeleteChain = {
          eq: (col: string, val: string) => {
            where[col] = val;
            return chain;
          },
          then: (onFulfilled, onRejected) => {
            state.deletes.push({ table, where });
            return Promise.resolve({
              data: null,
              error: state.deleteError,
            }).then(onFulfilled, onRejected);
          },
        };
        return chain;
      },
    }),
  };
}

import { lockPeriodAction, unlockPeriodAction } from "./actions";

function resetState(): void {
  state.inserts = [];
  state.deletes = [];
  state.insertError = null;
  state.deleteError = null;
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

describe("lockPeriodAction", () => {
  beforeEach(resetState);

  it("inserts a lock row scoped to the team with the period end and notes", async () => {
    await lockPeriodAction(
      fd({ team_id: "t1", period_end: "2026-06-30", notes: "Q2 close" }),
    );
    expect(state.inserts).toEqual([
      {
        table: "team_period_locks",
        rows: { team_id: "t1", period_end: "2026-06-30", notes: "Q2 close" },
      },
    ]);
    expect(mockValidateTeamAccess).toHaveBeenCalledWith("t1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
  });

  it("stores blank notes as null (not empty string)", async () => {
    await lockPeriodAction(
      fd({ team_id: "t1", period_end: "2026-06-30", notes: "  " }),
    );
    expect(state.inserts[0]?.rows).toMatchObject({ notes: null });
  });

  it("requires a team id — no write, no role check", async () => {
    await expect(
      lockPeriodAction(fd({ period_end: "2026-06-30" })),
    ).rejects.toThrow(/Team is required/);
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
    expect(state.inserts).toEqual([]);
  });

  it("rejects a malformed period_end (must be YYYY-MM-DD)", async () => {
    await expect(
      lockPeriodAction(fd({ team_id: "t1", period_end: "06/30/2026" })),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(state.inserts).toEqual([]);
  });

  it("rejects a missing period_end", async () => {
    await expect(lockPeriodAction(fd({ team_id: "t1" }))).rejects.toThrow(
      /YYYY-MM-DD/,
    );
    expect(state.inserts).toEqual([]);
  });

  it("rejects a plain member — only owners and admins can lock", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      lockPeriodAction(fd({ team_id: "t1", period_end: "2026-06-30" })),
    ).rejects.toThrow(/Only owners and admins can lock/);
    expect(state.inserts).toEqual([]);
  });

  it("admins pass the gate", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "admin",
    });
    await lockPeriodAction(fd({ team_id: "t1", period_end: "2026-06-30" }));
    expect(state.inserts).toHaveLength(1);
  });

  it("propagates a Supabase insert error as an AppError (DATABASE_ERROR)", async () => {
    state.insertError = { message: "duplicate period", code: "XX000" };
    await expect(
      lockPeriodAction(fd({ team_id: "t1", period_end: "2026-06-30" })),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "DATABASE_ERROR",
      message: "duplicate period",
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("unlockPeriodAction", () => {
  beforeEach(resetState);

  it("deletes the lock scoped by team AND period end when confirmed", async () => {
    await unlockPeriodAction(
      fd({ team_id: "t1", period_end: "2026-06-30", confirm: "unlock" }),
    );
    expect(state.deletes).toEqual([
      {
        table: "team_period_locks",
        where: { team_id: "t1", period_end: "2026-06-30" },
      },
    ]);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/business");
  });

  it("accepts the confirmation word case-insensitively", async () => {
    await unlockPeriodAction(
      fd({ team_id: "t1", period_end: "2026-06-30", confirm: "UNLOCK" }),
    );
    expect(state.deletes).toHaveLength(1);
  });

  it("refuses without the typed 'unlock' confirmation", async () => {
    await expect(
      unlockPeriodAction(
        fd({ team_id: "t1", period_end: "2026-06-30", confirm: "yes" }),
      ),
    ).rejects.toThrow(/Type 'unlock' to confirm/);
    expect(state.deletes).toEqual([]);
    // Confirmation is checked before the role lookup — a wrong word
    // never hits the DB or the membership check.
    expect(mockValidateTeamAccess).not.toHaveBeenCalled();
  });

  it("refuses when confirm is absent entirely", async () => {
    await expect(
      unlockPeriodAction(fd({ team_id: "t1", period_end: "2026-06-30" })),
    ).rejects.toThrow(/Type 'unlock' to confirm/);
    expect(state.deletes).toEqual([]);
  });

  it("requires team id and period end", async () => {
    await expect(
      unlockPeriodAction(fd({ period_end: "2026-06-30", confirm: "unlock" })),
    ).rejects.toThrow(/Team is required/);
    await expect(
      unlockPeriodAction(fd({ team_id: "t1", confirm: "unlock" })),
    ).rejects.toThrow(/Period end is required/);
    expect(state.deletes).toEqual([]);
  });

  it("rejects a plain member — only owners and admins can unlock", async () => {
    mockValidateTeamAccess.mockResolvedValue({
      userId: fakeUserId,
      role: "member",
    });
    await expect(
      unlockPeriodAction(
        fd({ team_id: "t1", period_end: "2026-06-30", confirm: "unlock" }),
      ),
    ).rejects.toThrow(/Only owners and admins can unlock/);
    expect(state.deletes).toEqual([]);
  });

  it("propagates a Supabase delete error as an AppError", async () => {
    state.deleteError = { message: "boom" };
    await expect(
      unlockPeriodAction(
        fd({ team_id: "t1", period_end: "2026-06-30", confirm: "unlock" }),
      ),
    ).rejects.toMatchObject({ name: "AppError", code: "DATABASE_ERROR" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
