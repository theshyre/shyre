"use client";

/**
 * Wayfinding breadcrumb mounted in the dashboard layout.
 *
 * Reads the current pathname, matches it against the breadcrumb
 * registry, and renders the trail. Static segments are translated
 * via i18n; dynamic segments (e.g. `[businessId]`) are resolved
 * client-side via the resolvers in `lib/breadcrumbs/resolvers.ts` —
 * a permission failure or missing entity falls back to a generic
 * "(unavailable)" label so the breadcrumb never crashes the page.
 *
 * Hidden when:
 *   - the current path doesn't match any registered route
 *   - the trail is a single segment (renders nothing — the page
 *     title is the only signal needed; "Profile" alone with no
 *     parent reads as visual noise)
 *
 * A11y shape per WAI-ARIA APG breadcrumb pattern:
 *   - <nav aria-label="Breadcrumb"> wrapper
 *   - <ol> of <li>s
 *   - last item: <span aria-current="page"> (no link)
 *   - separators: <span aria-hidden="true"> outside link names
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { matchBreadcrumbRoute, expandHref } from "@/lib/breadcrumbs/match";
import { resolveSegmentLabel } from "@/lib/breadcrumbs/resolvers";
import type { BreadcrumbSegmentSpec } from "@/lib/breadcrumbs/registry";

interface ResolvedSegment {
  id: string;
  label: string;
  href: string | null;
}

export function Breadcrumbs(): React.JSX.Element | null {
  const pathname = usePathname();
  // The breadcrumb messages live under the `common` namespace
  // (common.breadcrumb.*) so the keys ride alongside `nav.*` and
  // `navSections.*` instead of needing their own JSON file. Same
  // pattern Sidebar uses.
  const t = useTranslations("common.breadcrumb");

  // Seed the trail synchronously from the registry. Static segments
  // (i18n labels, structural nodes) come out fully resolved here;
  // dynamic segments carry a placeholder ("—") that the effect below
  // replaces once the async lookup completes.
  const seed = useMemo<ResolvedSegment[]>(() => {
    const match = matchBreadcrumbRoute(pathname);
    if (!match) return [];
    return match.trail.map((seg) => buildSeedSegment(seg, match.params, t));
  }, [pathname, t]);

  const [resolved, setResolved] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const match = matchBreadcrumbRoute(pathname);
    if (!match) return;
    const dynamicSegments = match.trail
      .map((seg, i) => ({ seg, i }))
      .filter(({ seg }) => seg.resolver);
    if (dynamicSegments.length === 0) return;
    let cancelled = false;
    void Promise.all(
      dynamicSegments.map(async ({ seg, i }) => {
        const param = seg.resolverParam
          ? match.params[seg.resolverParam]
          : "";
        const label = await resolveSegmentLabel(seg.resolver!, param ?? "");
        return { key: `${i}:${seg.id}`, label };
      }),
    ).then((entries) => {
      if (cancelled) return;
      setResolved((prev) => {
        const next = { ...prev };
        for (const { key, label } of entries) next[key] = label;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Merge async-resolved labels into the static seed.
  const segments: ResolvedSegment[] = seed.map((s, i) => {
    const key = `${i}:${s.id}`;
    if (key in resolved) {
      return {
        ...s,
        label: resolved[key] ?? t("fallbackEntity"),
      };
    }
    return s;
  });

  // Hide on routes with no trail or a single segment (page title is
  // enough on its own).
  if (segments.length < 2) return null;

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="mb-[12px]"
    >
      <ol className="flex items-center gap-[6px] text-caption text-content-muted flex-wrap">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <li key={seg.id} className="flex items-center gap-[6px]">
              {i > 0 ? (
                <span aria-hidden="true" className="text-content-muted">
                  ›
                </span>
              ) : null}
              {isLast ? (
                <span
                  aria-current="page"
                  className="text-content"
                >
                  {seg.label}
                </span>
              ) : seg.href ? (
                <Link
                  href={seg.href}
                  className="text-content-muted hover:text-content focus-visible:outline-none focus-visible:underline"
                >
                  {seg.label}
                </Link>
              ) : (
                // Structural segment with no navigation target (e.g. "Setup")
                <span className="text-content-muted">{seg.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function buildSeedSegment(
  spec: BreadcrumbSegmentSpec,
  params: Record<string, string>,
  t: ReturnType<typeof useTranslations>,
): ResolvedSegment {
  const href =
    spec.href === null ? null : expandHref(spec.href, params);
  if (spec.resolver) {
    // Placeholder while async resolver runs — em-dash is less
    // visually noisy than a spinner inside a wayfinding chip.
    return { id: spec.id, label: "—", href };
  }
  return {
    id: spec.id,
    label: spec.labelKey ? t(spec.labelKey) : "",
    href,
  };
}
