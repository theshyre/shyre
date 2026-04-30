/**
 * Path-pattern matching for the breadcrumb registry.
 *
 * Given a pathname like "/business/abc-123/people", finds the matching
 * route and extracts params: { pattern: "/business/[businessId]/people",
 * params: { businessId: "abc-123" } }. Most-specific-first match
 * priority — `/business/[id]/people` beats `/business/[id]`.
 */

import type { BreadcrumbRouteSpec } from "./registry";
import { BREADCRUMB_ROUTES } from "./registry";

export interface PatternMatch {
  pattern: string;
  params: Record<string, string>;
  trail: BreadcrumbRouteSpec["trail"];
}

/**
 * Compile a pattern into a regex. `[paramName]` becomes a captured
 * group; literal segments are escaped. Match is anchored to start +
 * end so /business doesn't match /business/123.
 */
function compilePattern(pattern: string): {
  re: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  const segments = pattern.split("/");
  const reSegments = segments.map((seg) => {
    const m = /^\[([^\]]+)\]$/.exec(seg);
    if (m) {
      paramNames.push(m[1]!);
      return "([^/]+)";
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return {
    re: new RegExp(`^${reSegments.join("/")}$`),
    paramNames,
  };
}

/**
 * Walk the registry, longest-pattern-first, and return the first
 * match. Specificity = number of literal (non-param) segments —
 * `/business/[id]/people` has 2 literal segments, `/business/[id]`
 * has 1. Longer literal-count wins.
 */
export function matchBreadcrumbRoute(
  pathname: string,
): PatternMatch | null {
  const sorted = [...BREADCRUMB_ROUTES].sort(
    (a, b) => specificity(b.pattern) - specificity(a.pattern),
  );
  for (const route of sorted) {
    const { re, paramNames } = compilePattern(route.pattern);
    const m = re.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1] ?? "");
    });
    return { pattern: route.pattern, params, trail: route.trail };
  }
  return null;
}

function specificity(pattern: string): number {
  return pattern
    .split("/")
    .filter((seg) => seg !== "" && !seg.startsWith("["))
    .length;
}

/**
 * Substitute `[paramName]` placeholders in an href with actual
 * params. Used to turn `/business/[businessId]` + `{businessId:
 * "abc-123"}` into `/business/abc-123` for the segment's link target.
 */
export function expandHref(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    return encodeURIComponent(params[name] ?? "");
  });
}
