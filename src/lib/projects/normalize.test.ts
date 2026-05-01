import { describe, it, expect } from "vitest";
import { normalizeGithubRepo } from "./normalize";

describe("normalizeGithubRepo", () => {
  it("returns null on null / empty / whitespace", () => {
    expect(normalizeGithubRepo(null)).toBeNull();
    expect(normalizeGithubRepo("")).toBeNull();
    expect(normalizeGithubRepo("   ")).toBeNull();
  });

  it("passes through canonical owner/repo", () => {
    expect(normalizeGithubRepo("theshyre/shyre")).toBe("theshyre/shyre");
    expect(normalizeGithubRepo("octokit/rest.js")).toBe("octokit/rest.js");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeGithubRepo("  theshyre/shyre  ")).toBe("theshyre/shyre");
  });

  it("strips https://github.com/ prefix", () => {
    expect(normalizeGithubRepo("https://github.com/theshyre/shyre")).toBe(
      "theshyre/shyre",
    );
  });

  it("strips http://github.com/ prefix", () => {
    expect(normalizeGithubRepo("http://github.com/theshyre/shyre")).toBe(
      "theshyre/shyre",
    );
  });

  it("strips github.com/ without protocol", () => {
    expect(normalizeGithubRepo("github.com/theshyre/shyre")).toBe(
      "theshyre/shyre",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeGithubRepo("https://github.com/theshyre/shyre/")).toBe(
      "theshyre/shyre",
    );
  });

  it("strips .git suffix", () => {
    expect(normalizeGithubRepo("https://github.com/theshyre/shyre.git")).toBe(
      "theshyre/shyre",
    );
  });

  it("trims deep links to owner/repo", () => {
    expect(
      normalizeGithubRepo("https://github.com/theshyre/shyre/tree/main"),
    ).toBe("theshyre/shyre");
    expect(
      normalizeGithubRepo("https://github.com/theshyre/shyre/issues/42"),
    ).toBe("theshyre/shyre");
    expect(
      normalizeGithubRepo("https://github.com/theshyre/shyre/pull/7/files"),
    ).toBe("theshyre/shyre");
  });

  it("strips ssh clone URL", () => {
    expect(
      normalizeGithubRepo("git@github.com:theshyre/shyre.git"),
    ).toBe("theshyre/shyre");
  });

  it("preserves dots and hyphens in repo names", () => {
    expect(normalizeGithubRepo("vercel/next.js")).toBe("vercel/next.js");
    expect(normalizeGithubRepo("octokit/rest.js")).toBe("octokit/rest.js");
    expect(normalizeGithubRepo("foo-bar/baz_qux")).toBe("foo-bar/baz_qux");
  });

  it("throws when only one segment is present", () => {
    expect(() => normalizeGithubRepo("theshyre")).toThrow(
      /owner\/repo/,
    );
    expect(() => normalizeGithubRepo("https://github.com/theshyre")).toThrow(
      /owner\/repo/,
    );
  });

  it("throws on non-github hosts", () => {
    // Without a github.com prefix, "gitlab.com/owner/repo" gets parsed
    // as 3 segments and would otherwise pass; ensure the host segment
    // is rejected (gitlab.com isn't a valid GH owner).
    expect(() => normalizeGithubRepo("gitlab.com/foo/bar")).toThrow(
      /owner\/repo/,
    );
  });

  it("throws on illegal characters", () => {
    expect(() => normalizeGithubRepo("space owner/repo")).toThrow(
      /owner\/repo/,
    );
    expect(() => normalizeGithubRepo("owner/repo with space")).toThrow(
      /owner\/repo/,
    );
  });
});
