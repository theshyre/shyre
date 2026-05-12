import { describe, it, expect } from "vitest";
import { BREADCRUMB_ROUTES } from "./registry";

/**
 * Data-invariants on the breadcrumb registry. The matching logic
 * itself lives in `match.ts` (its own tests); this file's job is to
 * catch authoring drift in the registry array — duplicated patterns,
 * empty trails, missing-resolver setups, broken href templates.
 *
 * Adding a new route to the registry should be caught here if it
 * violates any of the structural rules the renderer depends on.
 */

describe("BREADCRUMB_ROUTES registry", () => {
  it("contains at least one route", () => {
    expect(BREADCRUMB_ROUTES.length).toBeGreaterThan(0);
  });

  it("every route has a non-empty trail", () => {
    for (const r of BREADCRUMB_ROUTES) {
      expect(r.trail.length).toBeGreaterThan(0);
    }
  });

  it("patterns are unique (no duplicate registrations)", () => {
    const patterns = BREADCRUMB_ROUTES.map((r) => r.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("every pattern starts with a /", () => {
    for (const r of BREADCRUMB_ROUTES) {
      expect(r.pattern.startsWith("/")).toBe(true);
    }
  });

  it("every segment has a stable id", () => {
    for (const r of BREADCRUMB_ROUTES) {
      for (const s of r.trail) {
        expect(s.id).toMatch(/\S/);
      }
    }
  });

  it("segment.labelKey and segment.resolver are mutually exclusive", () => {
    for (const r of BREADCRUMB_ROUTES) {
      for (const s of r.trail) {
        const hasLabel = typeof s.labelKey === "string" && s.labelKey.length > 0;
        const hasResolver = typeof s.resolver === "string";
        // exactly one must be set
        expect(hasLabel || hasResolver).toBe(true);
        expect(hasLabel && hasResolver).toBe(false);
      }
    }
  });

  it("dynamic segments declare a resolverParam", () => {
    for (const r of BREADCRUMB_ROUTES) {
      for (const s of r.trail) {
        if (s.resolver) {
          expect(s.resolverParam).toMatch(/\S/);
        }
      }
    }
  });

  it("segment href templates reference only params present in the route pattern", () => {
    // Extract every [param] from the pattern, then for any segment
    // href that includes [param], make sure the pattern declared it.
    const paramsOf = (s: string): string[] =>
      Array.from(s.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1]!);
    for (const r of BREADCRUMB_ROUTES) {
      const patternParams = new Set(paramsOf(r.pattern));
      for (const seg of r.trail) {
        if (typeof seg.href !== "string") continue;
        for (const segParam of paramsOf(seg.href)) {
          expect(patternParams.has(segParam)).toBe(true);
        }
      }
    }
  });

  it("dynamic segments resolve a param that the pattern declares", () => {
    const paramsOf = (s: string): string[] =>
      Array.from(s.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1]!);
    for (const r of BREADCRUMB_ROUTES) {
      const patternParams = new Set(paramsOf(r.pattern));
      for (const seg of r.trail) {
        if (seg.resolver && seg.resolverParam) {
          expect(patternParams.has(seg.resolverParam)).toBe(true);
        }
      }
    }
  });

  it("includes the standard top-level Work entries (regression — these are sidebar-pinned)", () => {
    const patterns = new Set(BREADCRUMB_ROUTES.map((r) => r.pattern));
    expect(patterns.has("/time-entries")).toBe(true);
    expect(patterns.has("/customers")).toBe(true);
    expect(patterns.has("/projects")).toBe(true);
    expect(patterns.has("/invoices")).toBe(true);
  });

  it("at least one structural-parent segment exists (work / setup / system grouping)", () => {
    let foundStructural = false;
    for (const r of BREADCRUMB_ROUTES) {
      for (const seg of r.trail) {
        if (seg.id === "work" || seg.id === "setup" || seg.id === "system") {
          foundStructural = true;
        }
      }
    }
    expect(foundStructural).toBe(true);
  });
});
