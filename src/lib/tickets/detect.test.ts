import { describe, it, expect } from "vitest";
import { detectTicket, resolveTicketReference, ticketUrl } from "./detect";

describe("detectTicket", () => {
  describe("Jira", () => {
    it("matches PROJ-123 anywhere in the string", () => {
      expect(detectTicket("Working on PROJ-123 today")).toEqual({
        provider: "jira",
        key: "PROJ-123",
        matchedText: "PROJ-123",
      });
    });

    it("matches keys with digits inside the project part (e.g. AB1-42)", () => {
      // Atlassian allows digits after the first letter.
      const r = detectTicket("Investigated AB1-42");
      expect(r?.key).toBe("AB1-42");
    });

    it("matches keys with underscores (rare but legal)", () => {
      const r = detectTicket("Bug fix MY_PROJ-9");
      expect(r?.key).toBe("MY_PROJ-9");
    });

    it("does NOT match a single-letter prefix", () => {
      // Project keys are 2+ chars by Atlassian convention.
      expect(detectTicket("review of A-1 done")).toBeNull();
    });

    it("does NOT match lowercase strings (false-positive guard)", () => {
      // "iso-8859-1", "foo-123" — the description field gets a lot
      // of these and we don't want to try lookups on them.
      expect(detectTicket("encoding iso-8859-1 vs utf-8")).toBeNull();
      expect(detectTicket("foo-123 thing")).toBeNull();
    });

    it("returns the FIRST match when there are several", () => {
      const r = detectTicket("Touched PROJ-100, PROJ-200, BUG-3");
      expect(r?.key).toBe("PROJ-100");
    });

    it("returns null on empty string", () => {
      expect(detectTicket("")).toBeNull();
    });
  });

  describe("GitHub long form", () => {
    it("matches owner/repo#123", () => {
      expect(detectTicket("PR review: octokit/rest.js#42")).toEqual({
        provider: "github",
        key: "octokit/rest.js#42",
        matchedText: "octokit/rest.js#42",
      });
    });

    it("matches repos with dashes and dots", () => {
      const r = detectTicket("vercel/next.js#88888");
      expect(r?.key).toBe("vercel/next.js#88888");
    });

    it("does NOT match a path-style string with no #", () => {
      expect(detectTicket("see octokit/rest.js for details")).toBeNull();
    });

    it("wins over a co-occurring Jira reference", () => {
      // Long-form GitHub is more specific than a Jira key, so when
      // both appear in the same description we pick GitHub.
      const r = detectTicket("PROJ-1 — also see octokit/rest.js#42");
      expect(r?.provider).toBe("github");
    });
  });
});

describe("resolveTicketReference (with project defaults)", () => {
  it("resolves bare #123 against the project's default repo", () => {
    const r = resolveTicketReference("Working on #42", {
      defaultGithubRepo: "octokit/rest.js",
    });
    expect(r).toEqual({
      provider: "github",
      key: "octokit/rest.js#42",
      matchedText: "#42",
    });
  });

  it("does NOT resolve #123 when no defaultGithubRepo is set", () => {
    expect(resolveTicketReference("Working on #42")).toBeNull();
  });

  it("prefers a long-form match over a short-form one in the same text", () => {
    const r = resolveTicketReference("#10 vs vercel/next.js#88", {
      defaultGithubRepo: "octokit/rest.js",
    });
    expect(r?.key).toBe("vercel/next.js#88");
  });

  it("doesn't grab '#' out of the middle of a URL", () => {
    // The (^|[^\w/]) prefix prevents the URL fragment from matching.
    // /docs/x#section → "x#section" is rejected because the char
    // before '#' is a word char.
    expect(
      resolveTicketReference("see /docs/intro#setup", {
        defaultGithubRepo: "octokit/rest.js",
      }),
    ).toBeNull();
  });

  it("falls through to Jira when no GitHub form is present", () => {
    const r = resolveTicketReference("PROJ-9 follow-up", {
      defaultGithubRepo: "octokit/rest.js",
    });
    expect(r?.provider).toBe("jira");
    expect(r?.key).toBe("PROJ-9");
  });

  it("does not invent Jira matches from defaultJiraProjectKey alone (intentional limitation)", () => {
    // Per detect.ts comment: bare-number Jira shortrefs would
    // collide too often with text. Field is reserved for symmetry.
    expect(
      resolveTicketReference("ticket 123 done", {
        defaultJiraProjectKey: "PROJ",
      }),
    ).toBeNull();
  });
});

describe("ticketUrl", () => {
  it("builds Jira browse URLs against the user's base URL", () => {
    expect(
      ticketUrl(
        { provider: "jira", key: "PROJ-1" },
        { jiraBaseUrl: "https://example.atlassian.net" },
      ),
    ).toBe("https://example.atlassian.net/browse/PROJ-1");
  });

  it("strips trailing slash from the Jira base", () => {
    expect(
      ticketUrl(
        { provider: "jira", key: "PROJ-2" },
        { jiraBaseUrl: "https://example.atlassian.net/" },
      ),
    ).toBe("https://example.atlassian.net/browse/PROJ-2");
  });

  it("returns null for Jira when no base URL is configured", () => {
    expect(ticketUrl({ provider: "jira", key: "PROJ-3" })).toBeNull();
  });

  it("builds GitHub issue URLs from owner/repo#N", () => {
    expect(ticketUrl({ provider: "github", key: "octokit/rest.js#42" })).toBe(
      "https://github.com/octokit/rest.js/issues/42",
    );
  });

  it("returns null for malformed GitHub keys", () => {
    expect(ticketUrl({ provider: "github", key: "not-a-key" })).toBeNull();
  });
});
