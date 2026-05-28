"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Clock,
  Receipt,
  Settings as SettingsIcon,
  History as HistoryIcon,
} from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";

interface Props {
  projectId: string;
  /** History tab is admin-only — RLS on `projects_history` only
   *  permits owner/admin, so non-admins would hit an empty page.
   *  Hide the link rather than render it dead. */
  callerIsAdmin: boolean;
}

type SectionId = "overview" | "time" | "expenses" | "settings" | "history";

interface SectionDef {
  id: SectionId;
  href: string;
  /** True when the current pathname matches this section. Overview
   *  matches the bare `/projects/[id]`; other sections match their
   *  own segment. `startsWith` would over-match (Overview would
   *  light up on every sub-route), so each section provides its own
   *  predicate. */
  isActive: (pathname: string, projectId: string) => boolean;
  Icon: typeof LayoutDashboard;
  i18nKey: string;
  adminOnly?: boolean;
}

const SECTIONS: SectionDef[] = [
  {
    id: "overview",
    href: "",
    isActive: (p, id) => p === `/projects/${id}`,
    Icon: LayoutDashboard,
    i18nKey: "overview",
  },
  {
    id: "time",
    href: "/time",
    isActive: (p, id) => p === `/projects/${id}/time`,
    Icon: Clock,
    i18nKey: "time",
  },
  {
    id: "expenses",
    href: "/expenses",
    isActive: (p, id) => p === `/projects/${id}/expenses`,
    Icon: Receipt,
    i18nKey: "expenses",
  },
  {
    id: "settings",
    href: "/settings",
    isActive: (p, id) => p === `/projects/${id}/settings`,
    Icon: SettingsIcon,
    i18nKey: "settings",
  },
  {
    id: "history",
    href: "/history",
    isActive: (p, id) => p === `/projects/${id}/history`,
    Icon: HistoryIcon,
    i18nKey: "history",
    adminOnly: true,
  },
];

/**
 * Section nav strip for /projects/[id]/*. Matches the a11y
 * recommendation from the persona review:
 *
 *   - `<nav aria-label="…">` so SR users hear the landmark
 *   - `aria-current="page"` on the active link (no role="tab" —
 *     this is navigation, not a tab pattern, per the auditor's
 *     "sub-routes win the AT mental model" call)
 *   - After a route change, focus moves to the shared `<h1
 *     id="project-page-heading">` in the layout so SR users hear
 *     the new page's title and keyboard users land one Tab from
 *     the first interactive control.
 *
 * Pending-state feedback comes from `<LinkPendingSpinner>` inside
 * each link (a CLAUDE.md mandate for sidebar/list navigation).
 */
export function ProjectSectionNav({
  projectId,
  callerIsAdmin,
}: Props): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const t = useTranslations("projects.sectionNav");

  // After every pathname change, move focus to the layout's h1.
  // Layout renders the h1 with tabIndex={-1} so this is allowed.
  // Guarded by the "did the URL change" check so initial mount
  // doesn't steal focus from any auto-focused control on the page.
  useEffect(() => {
    const h1 = document.getElementById("project-page-heading");
    if (h1 instanceof HTMLElement) {
      h1.focus({ preventScroll: false });
    }
  }, [pathname]);

  const visibleSections = SECTIONS.filter(
    (s) => !s.adminOnly || callerIsAdmin,
  );

  return (
    <nav
      aria-label={t("ariaLabel")}
      className="mt-5 flex items-center gap-1 border-b border-edge overflow-x-auto"
    >
      {visibleSections.map((section) => {
        const active = section.isActive(pathname, projectId);
        const href = `/projects/${projectId}${section.href}`;
        const Icon = section.Icon;
        return (
          <Link
            key={section.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              "inline-flex items-center gap-1.5 px-3 py-2 text-body border-b-2 -mb-px transition-colors whitespace-nowrap " +
              (active
                ? "border-accent text-accent font-semibold"
                : "border-transparent text-content-secondary hover:text-content hover:border-edge-muted")
            }
          >
            <Icon size={14} aria-hidden="true" />
            <span>{t(section.i18nKey)}</span>
            <LinkPendingSpinner />
          </Link>
        );
      })}
    </nav>
  );
}
