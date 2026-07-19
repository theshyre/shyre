import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const state: {
  settingsRow: { github_token: string | null } | null;
} = { settingsRow: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: state.settingsRow, error: null }),
        }),
      }),
    }),
  }),
}));

const mockFetchIssues = vi.fn();
vi.mock("@/lib/github", () => ({
  fetchIssues: (...args: unknown[]) => mockFetchIssues(...args),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

import { GET } from "./route";

beforeEach(() => {
  state.settingsRow = { github_token: "ghp_secret" };
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  mockFetchIssues.mockReset();
  logErrorMock.mockClear();
});

const url = (qs: string): Request =>
  new Request(`https://shyre.test/api/github/issues${qs}`);

describe("GET /api/github/issues", () => {
  it("400s without a repo parameter", async () => {
    const res = await GET(url(""));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing repo parameter" });
    expect(mockFetchIssues).not.toHaveBeenCalled();
  });

  it("400s on a path-smuggling repo value (SAL hardening: owner/name only)", async () => {
    const res = await GET(url("?repo=foo%2Fbar%2Fissues%2F1%3F"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid repo format/);
    expect(mockFetchIssues).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(url("?repo=owner/name"));
    expect(res.status).toBe(401);
    expect(mockFetchIssues).not.toHaveBeenCalled();
  });

  it("400s when the user has no GitHub token configured", async () => {
    state.settingsRow = { github_token: null };
    const res = await GET(url("?repo=owner/name"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No GitHub token/);
  });

  it("returns issues on the happy path, passing repo + token + query through", async () => {
    mockFetchIssues.mockResolvedValue({
      data: [{ number: 1, title: "Bug" }],
      error: null,
    });
    const res = await GET(url("?repo=owner/name&q=crash"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ issues: [{ number: 1, title: "Bug" }] });
    expect(mockFetchIssues).toHaveBeenCalledWith("owner/name", "ghp_secret", {
      query: "crash",
    });
  });

  it("maps a GitHub error to its status and logs it (logError on non-2xx)", async () => {
    mockFetchIssues.mockResolvedValue({
      data: null,
      error: { message: "Bad credentials", status: 401 },
    });
    const res = await GET(url("?repo=owner/name"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Bad credentials");
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]?.[1]).toMatchObject({
      userId: "u1",
      url: "/api/github/issues",
      action: "fetchGithubIssues",
    });
    // The token must never ride along into the error log context.
    expect(JSON.stringify(logErrorMock.mock.calls[0])).not.toContain(
      "ghp_secret",
    );
  });

  it("falls back to 500 when the error carries no status", async () => {
    mockFetchIssues.mockResolvedValue({
      data: null,
      error: { message: "network down" },
    });
    const res = await GET(url("?repo=owner/name"));
    expect(res.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });
});
