import { describe, it, expect } from "vitest";
import { matchBreadcrumbRoute, expandHref } from "./match";

describe("matchBreadcrumbRoute", () => {
  it("returns null for an unregistered path", () => {
    expect(matchBreadcrumbRoute("/not-a-real-page")).toBeNull();
  });

  it("matches a static path", () => {
    const m = matchBreadcrumbRoute("/import");
    expect(m).not.toBeNull();
    expect(m!.pattern).toBe("/import");
    expect(m!.params).toEqual({});
  });

  it("extracts params from a dynamic segment", () => {
    const m = matchBreadcrumbRoute("/business/abc-123");
    expect(m).not.toBeNull();
    expect(m!.pattern).toBe("/business/[businessId]");
    expect(m!.params).toEqual({ businessId: "abc-123" });
  });

  it("prefers the longer pattern when multiple match", () => {
    // /business/[id]/people should beat /business/[id]
    const m = matchBreadcrumbRoute("/business/abc-123/people");
    expect(m).not.toBeNull();
    expect(m!.pattern).toBe("/business/[businessId]/people");
    expect(m!.params).toEqual({ businessId: "abc-123" });
  });

  it("matches /business (no children)", () => {
    const m = matchBreadcrumbRoute("/business");
    expect(m!.pattern).toBe("/business");
  });

  it("does not match a parent against a deeper path", () => {
    // /import has no children registered; /import/foo must not match
    const m = matchBreadcrumbRoute("/import/foo");
    expect(m).toBeNull();
  });

  it("decodes URL-encoded params", () => {
    const m = matchBreadcrumbRoute("/business/abc%20with%20spaces");
    expect(m!.params).toEqual({ businessId: "abc with spaces" });
  });

  it("matches /system sub-pages with longest-wins priority", () => {
    expect(matchBreadcrumbRoute("/system/errors")?.pattern).toBe(
      "/system/errors",
    );
    expect(matchBreadcrumbRoute("/system")?.pattern).toBe("/system");
  });

  it("returns the matched trail", () => {
    const m = matchBreadcrumbRoute("/import");
    expect(m!.trail).toHaveLength(2);
    expect(m!.trail[0]?.id).toBe("setup");
    expect(m!.trail[1]?.id).toBe("import");
  });
});

describe("expandHref", () => {
  it("substitutes a single param", () => {
    expect(expandHref("/business/[businessId]", { businessId: "abc" })).toBe(
      "/business/abc",
    );
  });

  it("substitutes multiple params", () => {
    expect(
      expandHref("/business/[bizId]/people/[personId]", {
        bizId: "b1",
        personId: "p2",
      }),
    ).toBe("/business/b1/people/p2");
  });

  it("URL-encodes params with spaces / special chars", () => {
    expect(expandHref("/teams/[teamId]", { teamId: "Team A&B" })).toBe(
      "/teams/Team%20A%26B",
    );
  });

  it("leaves placeholder empty when param missing", () => {
    expect(expandHref("/business/[businessId]", {})).toBe("/business/");
  });
});
