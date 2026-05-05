import { describe, expect, it } from "vitest";
import { formatTicketKeyForInput, parseTicketInput } from "./parse-input";

describe("parseTicketInput", () => {
  it("returns null for empty / whitespace input", () => {
    expect(parseTicketInput("")).toBeNull();
    expect(parseTicketInput("   ")).toBeNull();
  });

  it("parses long-form GitHub with no defaults", () => {
    expect(parseTicketInput("octokit/rest.js#42")).toEqual({
      provider: "github",
      key: "octokit/rest.js#42",
      matchedText: "octokit/rest.js#42",
    });
  });

  it("parses a full Jira key with no defaults", () => {
    expect(parseTicketInput("AE-640")).toEqual({
      provider: "jira",
      key: "AE-640",
      matchedText: "AE-640",
    });
  });

  it("uppercases lowercase Jira keys (forgiving paste)", () => {
    expect(parseTicketInput("ae-640")).toEqual({
      provider: "jira",
      key: "AE-640",
      matchedText: "ae-640",
    });
  });

  it("expands `#42` against defaultGithubRepo", () => {
    expect(
      parseTicketInput("#42", { defaultGithubRepo: "octokit/rest.js" }),
    ).toEqual({
      provider: "github",
      key: "octokit/rest.js#42",
      matchedText: "#42",
    });
  });

  it("returns null for `#42` without a default repo", () => {
    expect(parseTicketInput("#42")).toBeNull();
  });

  it("expands a bare number against the Jira default when only Jira is set", () => {
    expect(
      parseTicketInput("640", { defaultJiraProjectKey: "AE" }),
    ).toEqual({
      provider: "jira",
      key: "AE-640",
      matchedText: "640",
    });
  });

  it("expands a bare number against the GitHub default when only GitHub is set", () => {
    expect(
      parseTicketInput("42", { defaultGithubRepo: "octokit/rest.js" }),
    ).toEqual({
      provider: "github",
      key: "octokit/rest.js#42",
      matchedText: "42",
    });
  });

  it("prefers Jira when both providers are configured and no hint", () => {
    expect(
      parseTicketInput("640", {
        defaultJiraProjectKey: "AE",
        defaultGithubRepo: "octokit/rest.js",
      }),
    ).toEqual({
      provider: "jira",
      key: "AE-640",
      matchedText: "640",
    });
  });

  it("respects preferProvider when both configured", () => {
    expect(
      parseTicketInput("42", {
        defaultJiraProjectKey: "AE",
        defaultGithubRepo: "octokit/rest.js",
        preferProvider: "github",
      }),
    ).toEqual({
      provider: "github",
      key: "octokit/rest.js#42",
      matchedText: "42",
    });
  });

  it("falls back to the configured provider when preferProvider isn't set up", () => {
    expect(
      parseTicketInput("42", {
        defaultGithubRepo: "octokit/rest.js",
        preferProvider: "jira",
      }),
    ).toEqual({
      provider: "github",
      key: "octokit/rest.js#42",
      matchedText: "42",
    });
  });

  it("returns null for a bare number when no defaults are configured", () => {
    expect(parseTicketInput("42")).toBeNull();
  });

  it("returns null for nonsense input", () => {
    expect(parseTicketInput("not a ticket")).toBeNull();
    expect(parseTicketInput("AE")).toBeNull();
    expect(parseTicketInput("AE-")).toBeNull();
  });
});

describe("formatTicketKeyForInput", () => {
  it("strips the Jira project prefix when it matches the project", () => {
    expect(
      formatTicketKeyForInput(
        { provider: "jira", key: "AE-640" },
        { defaultJiraProjectKey: "AE" },
      ),
    ).toBe("640");
  });

  it("keeps the full Jira key when the prefix differs", () => {
    expect(
      formatTicketKeyForInput(
        { provider: "jira", key: "FOO-1" },
        { defaultJiraProjectKey: "AE" },
      ),
    ).toBe("FOO-1");
  });

  it("collapses GitHub long form to `#NN` when the repo matches", () => {
    expect(
      formatTicketKeyForInput(
        { provider: "github", key: "octokit/rest.js#42" },
        { defaultGithubRepo: "octokit/rest.js" },
      ),
    ).toBe("#42");
  });

  it("keeps the long form when the repo differs", () => {
    expect(
      formatTicketKeyForInput(
        { provider: "github", key: "other/repo#42" },
        { defaultGithubRepo: "octokit/rest.js" },
      ),
    ).toBe("other/repo#42");
  });

  it("returns the key unchanged when no defaults are passed", () => {
    expect(
      formatTicketKeyForInput({ provider: "jira", key: "AE-640" }),
    ).toBe("AE-640");
    expect(
      formatTicketKeyForInput({ provider: "github", key: "a/b#1" }),
    ).toBe("a/b#1");
  });
});
