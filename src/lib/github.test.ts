import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchIssues, fetchRepo, validateRepo } from "./github";
import type { GitHubIssue, GitHubRepo } from "./github";

const mockIssues: GitHubIssue[] = [
  {
    number: 1,
    title: "Fix login bug",
    state: "open",
    labels: [{ name: "bug", color: "d73a4a" }],
    html_url: "https://github.com/owner/repo/issues/1",
  },
  {
    number: 2,
    title: "Add dark mode",
    state: "open",
    labels: [{ name: "enhancement", color: "a2eeef" }],
    html_url: "https://github.com/owner/repo/issues/2",
  },
];

const mockRepo: GitHubRepo = {
  full_name: "owner/repo",
  description: "A test repo",
  html_url: "https://github.com/owner/repo",
  open_issues_count: 5,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchIssues", () => {
  it("fetches issues from GitHub API", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockIssues,
    } as Response);

    const { data, error } = await fetchIssues("owner/repo", "ghp_token");
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.[0]?.number).toBe(1);
  });

  it("passes auth header with Bearer token", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await fetchIssues("owner/repo", "ghp_test123");

    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs).toBeDefined();
    const [, options] = callArgs as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_test123");
  });

  it("filters issues by query", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockIssues,
    } as Response);

    const { data } = await fetchIssues("owner/repo", "ghp_token", {
      query: "dark",
    });
    expect(data).toHaveLength(1);
    expect(data?.[0]?.title).toBe("Add dark mode");
  });

  it("filters issues by number string", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockIssues,
    } as Response);

    const { data } = await fetchIssues("owner/repo", "ghp_token", {
      query: "1",
    });
    expect(data).toHaveLength(1);
    expect(data?.[0]?.number).toBe(1);
  });

  it("returns error on non-OK response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    const { data, error } = await fetchIssues("owner/repo", "ghp_token");
    expect(data).toBeNull();
    expect(error?.status).toBe(404);
  });

  it("returns error on network failure", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(
      new Error("Network error")
    );

    const { data, error } = await fetchIssues("owner/repo", "ghp_token");
    expect(data).toBeNull();
    expect(error?.message).toBe("Network error");
  });
});

describe("fetchRepo", () => {
  it("fetches repo details", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockRepo,
    } as Response);

    const { data, error } = await fetchRepo("owner/repo", "ghp_token");
    expect(error).toBeNull();
    expect(data?.full_name).toBe("owner/repo");
  });

  it("returns error for non-existent repo", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    const { data, error } = await fetchRepo("owner/nonexistent", "ghp_token");
    expect(data).toBeNull();
    expect(error?.status).toBe(404);
  });
});

describe("validateRepo", () => {
  it("returns true for valid repo", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockRepo,
    } as Response);

    const valid = await validateRepo("owner/repo", "ghp_token");
    expect(valid).toBe(true);
  });

  it("returns false for invalid repo", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    const valid = await validateRepo("owner/nonexistent", "ghp_token");
    expect(valid).toBe(false);
  });
});
