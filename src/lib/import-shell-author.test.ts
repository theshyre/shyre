import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildShellAccountEmail,
  buildShellAccountMetadata,
  isShellAccountMetadata,
  materializeHarvestShellAccount,
  SHELL_ACCOUNT_METADATA_KEY,
} from "./import-shell-author";

describe("buildShellAccountEmail", () => {
  it("uses the reserved invalid TLD so the address never reaches a real inbox", () => {
    const e = buildShellAccountEmail({
      source: "harvest",
      sourceUserId: "12345",
      teamId: "t-abc",
    });
    expect(e).toMatch(/@imported\.shyre\.invalid$/);
  });

  it("scopes by source + source-user-id + team so re-imports stay distinct", () => {
    const a = buildShellAccountEmail({
      source: "harvest",
      sourceUserId: "12345",
      teamId: "t-abc",
    });
    const b = buildShellAccountEmail({
      source: "harvest",
      sourceUserId: "12345",
      teamId: "t-xyz",
    });
    // Same Harvest user imported into a different team must produce
    // a different shell account — the addresses must differ.
    expect(a).not.toBe(b);
  });

  it("is deterministic for the same inputs (idempotency lookup)", () => {
    const a = buildShellAccountEmail({
      source: "harvest",
      sourceUserId: "9",
      teamId: "t-1",
    });
    const b = buildShellAccountEmail({
      source: "harvest",
      sourceUserId: "9",
      teamId: "t-1",
    });
    expect(a).toBe(b);
  });
});

describe("buildShellAccountMetadata", () => {
  it("marks the account with the well-known shell flag", () => {
    const m = buildShellAccountMetadata({
      source: "harvest",
      sourceUserId: "5",
      teamId: "t-1",
      displayName: "Jane Ex",
    });
    expect(m[SHELL_ACCOUNT_METADATA_KEY]).toBe(true);
    expect(m.imported_from).toBe("harvest");
    expect(m.source_user_id).toBe("5");
    expect(m.shell_team_id).toBe("t-1");
    expect(m.shell_display_name).toBe("Jane Ex");
  });
});

describe("isShellAccountMetadata", () => {
  it("returns true when the flag is present", () => {
    expect(isShellAccountMetadata({ shell_account: true })).toBe(true);
  });

  it("returns false on a real account's metadata blob", () => {
    expect(
      isShellAccountMetadata({ display_name: "Real User", shell_account: false }),
    ).toBe(false);
  });

  it("returns false on null / undefined / non-object inputs", () => {
    expect(isShellAccountMetadata(null)).toBe(false);
    expect(isShellAccountMetadata(undefined)).toBe(false);
  });

  it("returns false on an empty metadata object", () => {
    expect(isShellAccountMetadata({})).toBe(false);
  });
});

/**
 * Build a tiny mock admin Supabase client. Only the four surfaces
 * touched by materializeHarvestShellAccount are mocked:
 *   - auth.admin.listUsers
 *   - auth.admin.createUser
 *   - from("user_profiles").update({...}).eq(...)
 *   - from("team_members").insert({...})
 *
 * Each can be configured to fail or to return a specific shape.
 */
interface MockState {
  existingUsers: Array<{ id: string; email: string }>;
  createdUser?: { id: string; email: string };
  listError?: { message: string };
  createError?: { message: string };
  profileError?: { message: string };
  memberError?: { message: string };
  recordedProfileUpdate?: Record<string, unknown>;
  recordedMemberInsert?: Record<string, unknown>;
}

function buildMockAdmin(state: MockState): SupabaseClient {
  // The shape returned mirrors the live PostgREST builder enough for
  // the helper's await to resolve cleanly. Cast at the boundary so
  // we don't have to model the entire SupabaseClient type surface.
  const update = vi.fn((row: Record<string, unknown>) => {
    state.recordedProfileUpdate = row;
    return {
      eq: vi.fn(async () => ({
        error: state.profileError ?? null,
      })),
    };
  });
  const insert = vi.fn(async (row: Record<string, unknown>) => {
    state.recordedMemberInsert = row;
    return { error: state.memberError ?? null };
  });
  const from = vi.fn((table: string) => {
    if (table === "user_profiles") return { update };
    if (table === "team_members") return { insert };
    throw new Error(`unexpected table: ${table}`);
  });

  const listUsers = vi.fn(async () => ({
    data: { users: state.existingUsers },
    error: state.listError ?? null,
  }));
  const createUser = vi.fn(async () => ({
    data: { user: state.createdUser ?? null },
    error: state.createError ?? null,
  }));

  return {
    from,
    auth: { admin: { listUsers, createUser } },
  } as unknown as SupabaseClient;
}

describe("materializeHarvestShellAccount", () => {
  it("creates a fresh shell account when none exists", async () => {
    const state: MockState = {
      existingUsers: [],
      createdUser: { id: "u-new-shell", email: "harvest+5-t-1@imported.shyre.invalid" },
    };
    const admin = buildMockAdmin(state);

    const userId = await materializeHarvestShellAccount(admin, {
      teamId: "t-1",
      harvestUserId: 5,
      displayName: "Jane Ex",
    });

    expect(userId).toBe("u-new-shell");
    // user_profiles was stamped with the display name + shell flag
    expect(state.recordedProfileUpdate).toEqual({
      display_name: "Jane Ex",
      is_shell: true,
    });
    // team_members row was inserted with role member
    expect(state.recordedMemberInsert).toEqual({
      team_id: "t-1",
      user_id: "u-new-shell",
      role: "member",
    });
  });

  it("is idempotent — returns the existing user_id when a matching shell already exists", async () => {
    const email = "harvest+5-t-1@imported.shyre.invalid";
    const state: MockState = {
      existingUsers: [{ id: "u-existing", email }],
    };
    const admin = buildMockAdmin(state);

    const userId = await materializeHarvestShellAccount(admin, {
      teamId: "t-1",
      harvestUserId: 5,
      displayName: "Jane Ex",
    });

    expect(userId).toBe("u-existing");
    // No profile or member writes — the existing account is reused
    expect(state.recordedProfileUpdate).toBeUndefined();
    expect(state.recordedMemberInsert).toBeUndefined();
  });

  it("throws a clear error when listUsers fails", async () => {
    const state: MockState = {
      existingUsers: [],
      listError: { message: "rate limited" },
    };
    const admin = buildMockAdmin(state);
    await expect(
      materializeHarvestShellAccount(admin, {
        teamId: "t-1",
        harvestUserId: 5,
        displayName: "Jane Ex",
      }),
    ).rejects.toThrow(/listUsers failed: rate limited/);
  });

  it("throws when createUser returns an error", async () => {
    const state: MockState = {
      existingUsers: [],
      createError: { message: "email already in use" },
    };
    const admin = buildMockAdmin(state);
    await expect(
      materializeHarvestShellAccount(admin, {
        teamId: "t-1",
        harvestUserId: 5,
        displayName: "Jane Ex",
      }),
    ).rejects.toThrow(/Shell account create failed.*email already in use/);
  });

  it("throws when the profile update fails — the auth user without a profile is broken", async () => {
    const state: MockState = {
      existingUsers: [],
      createdUser: { id: "u-new-shell", email: "harvest+5-t-1@imported.shyre.invalid" },
      profileError: { message: "no row" },
    };
    const admin = buildMockAdmin(state);
    await expect(
      materializeHarvestShellAccount(admin, {
        teamId: "t-1",
        harvestUserId: 5,
        displayName: "Jane Ex",
      }),
    ).rejects.toThrow(/user_profiles update failed: no row/);
  });

  it("throws when the team_members insert fails", async () => {
    const state: MockState = {
      existingUsers: [],
      createdUser: { id: "u-new-shell", email: "harvest+5-t-1@imported.shyre.invalid" },
      memberError: { message: "duplicate key" },
    };
    const admin = buildMockAdmin(state);
    await expect(
      materializeHarvestShellAccount(admin, {
        teamId: "t-1",
        harvestUserId: 5,
        displayName: "Jane Ex",
      }),
    ).rejects.toThrow(/team_members insert failed: duplicate key/);
  });
});
