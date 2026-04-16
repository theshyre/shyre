import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Supabase mock with pluggable auth + table results ---
const mockGetUser = vi.fn();
const mockSystemAdminsSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table !== "system_admins") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => mockSystemAdminsSingle(),
          }),
        }),
      };
    },
  }),
}));

const mockRedirect = vi.fn((path: string): never => {
  const err = new Error(`NEXT_REDIRECT ${path}`) as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};307;`;
  throw err;
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

import { isSystemAdmin, requireSystemAdmin } from "./system-admin";

describe("isSystemAdmin", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockSystemAdminsSingle.mockReset();
    mockRedirect.mockClear();
  });

  it("returns false when there is no authenticated user (never queries DB)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await isSystemAdmin();
    expect(result).toBe(false);
    expect(mockSystemAdminsSingle).not.toHaveBeenCalled();
  });

  it("returns true when the user has a row in system_admins", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockSystemAdminsSingle.mockResolvedValue({
      data: { user_id: "admin-1" },
    });
    expect(await isSystemAdmin()).toBe(true);
  });

  it("returns false when the user has no row in system_admins", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "regular" } } });
    mockSystemAdminsSingle.mockResolvedValue({ data: null });
    expect(await isSystemAdmin()).toBe(false);
  });

  it("returns false when the query returns null even with PostgREST row-not-found", async () => {
    // PGRST116: row not found — supabase returns { data: null, error: {...} }
    mockGetUser.mockResolvedValue({ data: { user: { id: "x" } } });
    mockSystemAdminsSingle.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "Not found" },
    });
    expect(await isSystemAdmin()).toBe(false);
  });
});

describe("requireSystemAdmin", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockSystemAdminsSingle.mockReset();
    mockRedirect.mockClear();
  });

  it("redirects to /login when there is no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(requireSystemAdmin()).rejects.toThrow(/NEXT_REDIRECT.*\/login/);
    expect(mockRedirect).toHaveBeenCalledWith("/login");
    expect(mockSystemAdminsSingle).not.toHaveBeenCalled();
  });

  it("redirects to / when the user exists but is not a system admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "regular" } } });
    mockSystemAdminsSingle.mockResolvedValue({ data: null });
    await expect(requireSystemAdmin()).rejects.toThrow(/NEXT_REDIRECT.*\/$/);
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("returns { userId } when the user is a system admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-7" } } });
    mockSystemAdminsSingle.mockResolvedValue({
      data: { user_id: "admin-7" },
    });
    const result = await requireSystemAdmin();
    expect(result).toEqual({ userId: "admin-7" });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("fails closed: does not leak the admin-check DB error as a thrown error to the caller", async () => {
    // DB error on the admin check → `data` is null → redirect to /.
    // Important: we don't want a DB hiccup to accidentally grant admin.
    mockGetUser.mockResolvedValue({ data: { user: { id: "x" } } });
    mockSystemAdminsSingle.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: "table missing" },
    });
    await expect(requireSystemAdmin()).rejects.toThrow(/NEXT_REDIRECT.*\/$/);
  });
});
