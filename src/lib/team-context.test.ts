import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Supabase mock with pluggable auth + table results ---
const mockGetUser = vi.fn();
const mockProfileSingle = vi.fn();
const mockTeamMembersList = vi.fn();
const mockMembershipSingle = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    rpc: (fn: string, args: Record<string, unknown>) => mockRpc(fn, args),
    from: (table: string) => {
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => mockProfileSingle(),
            }),
          }),
        };
      }
      if (table === "team_members") {
        return {
          select: () => ({
            eq: (col: string, _val: string) => {
              if (col === "user_id") {
                return {
                  order: () => mockTeamMembersList(),
                  eq: () => ({
                    single: () => mockMembershipSingle(),
                  }),
                };
              }
              throw new Error(`unexpected eq col ${col}`);
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
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

import {
  getUserContext,
  getUserTeams,
  getUserTeamIds,
  requireTeamAdmin,
  validateBusinessAccess,
  validateTeamAccess,
} from "./team-context";

beforeEach(() => {
  mockGetUser.mockReset();
  mockProfileSingle.mockReset();
  mockTeamMembersList.mockReset();
  mockMembershipSingle.mockReset();
  mockRpc.mockReset();
  mockRedirect.mockClear();
});

describe("getUserContext", () => {
  it("redirects to /login when there is no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(getUserContext()).rejects.toThrow(/NEXT_REDIRECT.*\/login/);
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("returns profile display_name when present", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "jane@doe.test" } },
    });
    mockProfileSingle.mockResolvedValue({
      data: { display_name: "Jane Doe", avatar_url: null },
    });
    const ctx = await getUserContext();
    expect(ctx).toEqual({
      userId: "u1",
      userEmail: "jane@doe.test",
      displayName: "Jane Doe",
      avatarUrl: null,
    });
  });

  it("returns the avatar_url alongside display_name", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "jane@doe.test" } },
    });
    mockProfileSingle.mockResolvedValue({
      data: {
        display_name: "Jane Doe",
        avatar_url: "https://cdn/avatars/u1.png",
      },
    });
    const ctx = await getUserContext();
    expect(ctx.avatarUrl).toBe("https://cdn/avatars/u1.png");
  });

  it("falls back to the email-prefix when the profile has no display_name", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "sam@example.test" } },
    });
    mockProfileSingle.mockResolvedValue({ data: null });
    const ctx = await getUserContext();
    expect(ctx.displayName).toBe("sam");
  });

  it("falls back to 'User' when the user has no email at all", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: null } },
    });
    mockProfileSingle.mockResolvedValue({ data: null });
    const ctx = await getUserContext();
    expect(ctx.displayName).toBe("User");
    expect(ctx.userEmail).toBe("");
  });
});

describe("getUserTeams", () => {
  it("returns an empty list (no DB hit) when there is no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const teams = await getUserTeams();
    expect(teams).toEqual([]);
    expect(mockTeamMembersList).not.toHaveBeenCalled();
  });

  it("maps team_members rows into { id, name, slug, role } items", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockTeamMembersList.mockResolvedValue({
      data: [
        {
          role: "owner",
          teams: { id: "t1", name: "Acme", slug: "acme" },
        },
        {
          role: "member",
          teams: { id: "t2", name: "Beta", slug: "beta" },
        },
      ],
    });
    const teams = await getUserTeams();
    expect(teams).toEqual([
      { id: "t1", name: "Acme", slug: "acme", role: "owner" },
      { id: "t2", name: "Beta", slug: "beta", role: "member" },
    ]);
  });

  it("drops rows where the teams relation is missing (corrupt FK / RLS)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockTeamMembersList.mockResolvedValue({
      data: [
        { role: "owner", teams: null },
        {
          role: "admin",
          teams: { id: "t1", name: "Real", slug: "real" },
        },
      ],
    });
    const teams = await getUserTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0]?.id).toBe("t1");
  });

  it("returns [] when the query comes back with data: null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockTeamMembersList.mockResolvedValue({ data: null });
    expect(await getUserTeams()).toEqual([]);
  });
});

describe("getUserTeamIds", () => {
  it("returns just the ids from getUserTeams", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockTeamMembersList.mockResolvedValue({
      data: [
        {
          role: "owner",
          teams: { id: "t1", name: "A", slug: "a" },
        },
        {
          role: "member",
          teams: { id: "t2", name: "B", slug: "b" },
        },
      ],
    });
    expect(await getUserTeamIds()).toEqual(["t1", "t2"]);
  });

  it("returns [] when the user has no teams", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await getUserTeamIds()).toEqual([]);
  });
});

describe("validateTeamAccess", () => {
  it("redirects to /login when there is no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(validateTeamAccess("team-1")).rejects.toThrow(
      /NEXT_REDIRECT.*\/login/,
    );
  });

  it("throws when the user is not a member of the team", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockMembershipSingle.mockResolvedValue({ data: null });
    await expect(validateTeamAccess("team-1")).rejects.toThrow(
      /do not have access/,
    );
  });

  it("returns { userId, role } for an authorized member", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockMembershipSingle.mockResolvedValue({ data: { role: "admin" } });
    const result = await validateTeamAccess("team-1");
    expect(result).toEqual({ userId: "u1", role: "admin" });
  });

  it("preserves the 'owner' and 'member' roles faithfully", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockMembershipSingle.mockResolvedValue({ data: { role: "owner" } });
    expect((await validateTeamAccess("x")).role).toBe("owner");
    mockMembershipSingle.mockResolvedValue({ data: { role: "member" } });
    expect((await validateTeamAccess("y")).role).toBe("member");
  });
});

describe("requireTeamAdmin", () => {
  it("throws for a plain member — the owner/admin gate is baked in", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockMembershipSingle.mockResolvedValue({ data: { role: "member" } });
    await expect(requireTeamAdmin("team-1")).rejects.toThrow(
      /Only team owners and admins/,
    );
  });

  it("throws for a non-member (no membership row at all)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockMembershipSingle.mockResolvedValue({ data: null });
    await expect(requireTeamAdmin("team-1")).rejects.toThrow(
      /do not have access/,
    );
  });

  it("returns the actual role for owner and admin (callers differentiate)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockMembershipSingle.mockResolvedValue({ data: { role: "owner" } });
    expect(await requireTeamAdmin("team-1")).toEqual({
      userId: "u1",
      role: "owner",
    });
    mockMembershipSingle.mockResolvedValue({ data: { role: "admin" } });
    expect(await requireTeamAdmin("team-1")).toEqual({
      userId: "u1",
      role: "admin",
    });
  });

  it("redirects to /login when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(requireTeamAdmin("team-1")).rejects.toThrow(
      /NEXT_REDIRECT.*\/login/,
    );
  });
});

describe("validateBusinessAccess", () => {
  it("redirects to /login when unauthenticated — before the rpc runs", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(validateBusinessAccess("biz-1")).rejects.toThrow(
      /NEXT_REDIRECT.*\/login/,
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws the denial when the rpc resolves NULL (no membership in any of the business's teams)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(validateBusinessAccess("biz-1")).rejects.toThrow(
      /do not have access to this business/,
    );
    expect(mockRpc).toHaveBeenCalledWith("user_business_role", {
      business_id: "biz-1",
    });
  });

  it("propagates an rpc error instead of granting access (fail closed)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const rpcError = new Error("function user_business_role does not exist");
    mockRpc.mockResolvedValue({ data: null, error: rpcError });
    await expect(validateBusinessAccess("biz-1")).rejects.toThrow(
      /user_business_role does not exist/,
    );
  });

  it("returns { userId, role } when the rpc resolves a role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockRpc.mockResolvedValue({ data: "admin", error: null });
    expect(await validateBusinessAccess("biz-1")).toEqual({
      userId: "u1",
      role: "admin",
    });
  });
});
