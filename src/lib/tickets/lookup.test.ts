import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock hoists above imports, so mock fns must come from
// vi.hoisted() to be reachable in the factories.
const { fetchSingleIssueMock, fetchJiraIssueMock, logErrorMock } = vi.hoisted(
  () => ({
    fetchSingleIssueMock: vi.fn(),
    fetchJiraIssueMock: vi.fn(),
    logErrorMock: vi.fn(),
  }),
);

vi.mock("@/lib/github", () => ({
  fetchSingleIssue: fetchSingleIssueMock,
}));
vi.mock("@/lib/jira", () => ({
  fetchJiraIssue: fetchJiraIssueMock,
}));
vi.mock("@/lib/logger", () => ({
  logError: logErrorMock,
}));

import { lookupTicket } from "./lookup";
import type { DetectedTicket } from "./detect";

interface FakeSettings {
  github_token: string | null;
  jira_base_url: string | null;
  jira_email: string | null;
  jira_api_token: string | null;
}

function makeSupabase(settings: FakeSettings | null) {
  // Minimal mock of the chain
  // supabase.from("user_settings").select(...).eq(...).maybeSingle()
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: settings, error: null }),
        }),
      }),
    }),
  };
}

const ghTicket: DetectedTicket = {
  provider: "github",
  key: "octokit/rest.js#42",
  matchedText: "octokit/rest.js#42",
};

const jiraTicket: DetectedTicket = {
  provider: "jira",
  key: "PROJ-1",
  matchedText: "PROJ-1",
};

beforeEach(() => {
  fetchSingleIssueMock.mockReset();
  fetchJiraIssueMock.mockReset();
  logErrorMock.mockReset();
});

describe("lookupTicket — GitHub", () => {
  it("returns null when no GitHub token is configured", async () => {
    const supabase = makeSupabase({
      github_token: null,
      jira_base_url: null,
      jira_email: null,
      jira_api_token: null,
    });
    const result = await lookupTicket(supabase as never, "u1", ghTicket);
    expect(result).toBeNull();
    expect(fetchSingleIssueMock).not.toHaveBeenCalled();
  });

  it("returns null and does not log on a 404 (chatty path)", async () => {
    const supabase = makeSupabase({
      github_token: "ghp_x",
      jira_base_url: null,
      jira_email: null,
      jira_api_token: null,
    });
    fetchSingleIssueMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Not Found", status: 404 },
    });
    const result = await lookupTicket(supabase as never, "u1", ghTicket);
    expect(result).toBeNull();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("returns null and DOES log on a 500", async () => {
    const supabase = makeSupabase({
      github_token: "ghp_x",
      jira_base_url: null,
      jira_email: null,
      jira_api_token: null,
    });
    fetchSingleIssueMock.mockResolvedValueOnce({
      data: null,
      error: { message: "internal", status: 500 },
    });
    const result = await lookupTicket(supabase as never, "u1", ghTicket);
    expect(result).toBeNull();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("does not log on the network-error sentinel (status 0)", async () => {
    const supabase = makeSupabase({
      github_token: "ghp_x",
      jira_base_url: null,
      jira_email: null,
      jira_api_token: null,
    });
    fetchSingleIssueMock.mockResolvedValueOnce({
      data: null,
      error: { message: "ECONNREFUSED", status: 0 },
    });
    await lookupTicket(supabase as never, "u1", ghTicket);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("returns the resolved ticket on success", async () => {
    const supabase = makeSupabase({
      github_token: "ghp_x",
      jira_base_url: null,
      jira_email: null,
      jira_api_token: null,
    });
    fetchSingleIssueMock.mockResolvedValueOnce({
      data: {
        number: 42,
        title: "Fix login",
        state: "open",
        html_url: "https://github.com/octokit/rest.js/issues/42",
      },
      error: null,
    });
    const result = await lookupTicket(supabase as never, "u1", ghTicket);
    expect(result).toEqual({
      provider: "github",
      key: "octokit/rest.js#42",
      url: "https://github.com/octokit/rest.js/issues/42",
      title: "Fix login",
    });
  });

  it("returns null when the GitHub key is malformed (no /rest.js#NN)", async () => {
    const supabase = makeSupabase({
      github_token: "ghp_x",
      jira_base_url: null,
      jira_email: null,
      jira_api_token: null,
    });
    const result = await lookupTicket(supabase as never, "u1", {
      provider: "github",
      key: "garbage",
      matchedText: "garbage",
    });
    expect(result).toBeNull();
    expect(fetchSingleIssueMock).not.toHaveBeenCalled();
  });
});

describe("lookupTicket — Jira", () => {
  it("returns null when Jira creds aren't fully configured", async () => {
    // Email missing — partial config doesn't pass the gate.
    const supabase = makeSupabase({
      github_token: null,
      jira_base_url: "https://acme.atlassian.net",
      jira_email: null,
      jira_api_token: "tok",
    });
    const result = await lookupTicket(supabase as never, "u1", jiraTicket);
    expect(result).toBeNull();
    expect(fetchJiraIssueMock).not.toHaveBeenCalled();
  });

  it("returns the resolved ticket on success", async () => {
    const supabase = makeSupabase({
      github_token: null,
      jira_base_url: "https://acme.atlassian.net",
      jira_email: "alice@example.com",
      jira_api_token: "tok",
    });
    fetchJiraIssueMock.mockResolvedValueOnce({
      data: {
        key: "PROJ-1",
        summary: "Fix login",
        browseUrl: "https://acme.atlassian.net/browse/PROJ-1",
      },
      error: null,
    });
    const result = await lookupTicket(supabase as never, "u1", jiraTicket);
    expect(result).toEqual({
      provider: "jira",
      key: "PROJ-1",
      url: "https://acme.atlassian.net/browse/PROJ-1",
      title: "Fix login",
    });
  });

  it("logs on non-404 / non-network Jira errors", async () => {
    const supabase = makeSupabase({
      github_token: null,
      jira_base_url: "https://acme.atlassian.net",
      jira_email: "alice@example.com",
      jira_api_token: "tok",
    });
    fetchJiraIssueMock.mockResolvedValueOnce({
      data: null,
      error: { message: "internal", status: 500 },
    });
    const result = await lookupTicket(supabase as never, "u1", jiraTicket);
    expect(result).toBeNull();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });
});
