import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_TOKEN = "abcdefghijklmnopqrst";

interface InviteRow {
  id: string;
  team_id: string;
  email: string;
  role: string;
  expires_at: string;
}

const state: {
  user: { id: string; email: string | null } | null;
  invite: InviteRow | null;
  inviteError: { message: string } | null;
  /** True when the team_members lookup finds the user already in the
   *  team (skip-the-insert short circuit). */
  existingMembership: boolean;
  inserts: { table: string; rows: unknown }[];
  insertError: { message: string } | null;
  updates: { table: string; patch: unknown; where: Record<string, string> }[];
} = {
  user: null,
  invite: null,
  inviteError: null,
  existingMembership: false,
  inserts: [],
  insertError: null,
  updates: [],
};

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase(),
}));

function mockSupabase() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      if (table === "team_invites") return inviteTable();
      if (table === "team_members") return memberTable();
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function inviteTable() {
  return {
    select: () => ({
      eq: () => ({
        is: () => ({
          single: () =>
            state.inviteError
              ? Promise.resolve({ data: null, error: state.inviteError })
              : state.invite
                ? Promise.resolve({ data: state.invite, error: null })
                : Promise.resolve({
                    data: null,
                    error: { message: "no rows", code: "PGRST116" },
                  }),
        }),
      }),
    }),
    update: (patch: unknown) => ({
      eq: (col: string, val: string) => {
        state.updates.push({
          table: "team_invites",
          patch,
          where: { [col]: val },
        });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
}

function memberTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          single: () =>
            state.existingMembership
              ? Promise.resolve({ data: { id: "existing-1" }, error: null })
              : Promise.resolve({
                  data: null,
                  error: { message: "no rows", code: "PGRST116" },
                }),
        }),
      }),
    }),
    insert: (rows: unknown) => {
      state.inserts.push({ table: "team_members", rows });
      return Promise.resolve({
        data: null,
        error: state.insertError,
      });
    },
  };
}

import { GET } from "./route";

function reset(): void {
  state.user = null;
  state.invite = null;
  state.inviteError = null;
  state.existingMembership = false;
  state.inserts = [];
  state.insertError = null;
  state.updates = [];
  mockLogError.mockReset();
}

function makeReq(token: string | null): Request {
  const url = token
    ? `https://shyre.test/auth/accept-invite?token=${token}`
    : `https://shyre.test/auth/accept-invite`;
  return new Request(url);
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

describe("/auth/accept-invite", () => {
  beforeEach(reset);

  it("redirects to login with missing_token when token is absent", async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(
      "/login?error=missing_token",
    );
  });

  it("rejects malformed tokens (regex gate) before any DB read", async () => {
    const res = await GET(makeReq("../etc/passwd"));
    expect(res.headers.get("location")).toContain("missing_token");
    // No invites table read happened.
    expect(state.inserts).toEqual([]);
  });

  it("redirects to /login?next=… when not authenticated", async () => {
    state.user = null;
    const res = await GET(makeReq(VALID_TOKEN));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login?next=");
    expect(location).toContain(
      encodeURIComponent(`/auth/accept-invite?token=${VALID_TOKEN}`),
    );
  });

  it("redirects with invalid_invite when no row matches the token", async () => {
    state.user = { id: "u-1", email: "alice@example.com" };
    state.invite = null;

    const res = await GET(makeReq(VALID_TOKEN));
    expect(res.headers.get("location")).toContain(
      "/?error=invalid_invite",
    );
  });

  it("redirects with invite_expired when expires_at is in the past", async () => {
    state.user = { id: "u-1", email: "alice@example.com" };
    state.invite = {
      id: "inv-1",
      team_id: "team-1",
      email: "alice@example.com",
      role: "member",
      expires_at: PAST,
    };

    const res = await GET(makeReq(VALID_TOKEN));
    expect(res.headers.get("location")).toContain(
      "/?error=invite_expired",
    );
    expect(state.inserts).toEqual([]);
  });

  it("redirects with email_mismatch when invite is for a different email", async () => {
    state.user = { id: "u-1", email: "alice@example.com" };
    state.invite = {
      id: "inv-1",
      team_id: "team-1",
      email: "bob@example.com",
      role: "member",
      expires_at: FUTURE,
    };

    const res = await GET(makeReq(VALID_TOKEN));
    expect(res.headers.get("location")).toContain(
      "/?error=email_mismatch",
    );
    expect(state.inserts).toEqual([]);
  });

  it("matches email case-insensitively", async () => {
    state.user = { id: "u-1", email: "ALICE@example.com" };
    state.invite = {
      id: "inv-1",
      team_id: "team-1",
      email: "alice@example.com",
      role: "member",
      expires_at: FUTURE,
    };

    const res = await GET(makeReq(VALID_TOKEN));
    expect(res.headers.get("location")).toMatch(/\/$|\/\?/);
    expect(res.headers.get("location")).not.toContain("error=");
    expect(state.inserts).toEqual([
      {
        table: "team_members",
        rows: { team_id: "team-1", user_id: "u-1", role: "member" },
      },
    ]);
  });

  it("short-circuits when the user is already a member (no insert)", async () => {
    state.user = { id: "u-1", email: "alice@example.com" };
    state.invite = {
      id: "inv-1",
      team_id: "team-1",
      email: "alice@example.com",
      role: "member",
      expires_at: FUTURE,
    };
    state.existingMembership = true;

    const res = await GET(makeReq(VALID_TOKEN));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/$|\/\?/);
    expect(state.inserts).toEqual([]);
    // No accept timestamp update either — the user wasn't newly
    // accepted, the row was already there.
    expect(state.updates).toEqual([]);
  });

  it("inserts the membership AND marks the invite accepted on the happy path", async () => {
    state.user = { id: "u-1", email: "alice@example.com" };
    state.invite = {
      id: "inv-1",
      team_id: "team-1",
      email: "alice@example.com",
      role: "admin",
      expires_at: FUTURE,
    };

    const res = await GET(makeReq(VALID_TOKEN));
    expect(res.status).toBe(307);
    expect(state.inserts).toEqual([
      {
        table: "team_members",
        rows: { team_id: "team-1", user_id: "u-1", role: "admin" },
      },
    ]);
    expect(state.updates).toEqual([
      expect.objectContaining({ table: "team_invites", where: { id: "inv-1" } }),
    ]);
  });

  it("logs the memberError and redirects to join_failed when the insert fails", async () => {
    state.user = { id: "u-1", email: "alice@example.com" };
    state.invite = {
      id: "inv-1",
      team_id: "team-1",
      email: "alice@example.com",
      role: "member",
      expires_at: FUTURE,
    };
    state.insertError = { message: "FK violation" };

    const res = await GET(makeReq(VALID_TOKEN));
    expect(res.headers.get("location")).toContain("/?error=join_failed");
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [err, ctx] = mockLogError.mock.calls[0]!;
    expect(err).toEqual({ message: "FK violation" });
    expect(ctx).toEqual(
      expect.objectContaining({
        userId: "u-1",
        teamId: "team-1",
        url: "/auth/accept-invite",
        action: "acceptInvite",
      }),
    );
    // No accept-timestamp update on the failure path.
    expect(state.updates).toEqual([]);
  });
});
