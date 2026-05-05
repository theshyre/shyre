"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  ShieldAlert,
  Building2,
  Menu,
} from "lucide-react";
import type { ComponentType } from "react";
import Timer from "./Timer";
import { LinkPendingSpinner } from "./LinkPendingSpinner";
import { Tooltip } from "./Tooltip";
import { Logo } from "./Logo";
import { ProfilePopover } from "./ProfilePopover";
import { navItemsForSection } from "@/lib/modules/registry";

interface NavItem {
  labelKey: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Count badge (e.g. unresolved errors on Admin for system admins). */
  badge?: number;
}

type Translator = ReturnType<typeof useTranslations>;

/** Shared link renderer for both Work and Setup sections. Pulled out
 *  of the component body so a section-aware nav can map over its
 *  items without duplicating the active-state + badge + spinner
 *  scaffolding.
 *
 *  `pathname` is threaded through so the link can compute exact-match
 *  vs ancestor-match for `aria-current`:
 *    - exact match → `aria-current="page"` (the canonical "you are here")
 *    - ancestor match (e.g. /business is "active" while on
 *      /business/[id]/people) → `aria-current="true"` (an honest "your
 *      current page lives somewhere under this") */
function renderNavLink(
  item: NavItem,
  t: Translator,
  pathname: string,
): React.JSX.Element {
  const Icon = item.icon;
  const isExact =
    item.href === "/" ? pathname === "/" : pathname === item.href;
  const isAncestor =
    item.href !== "/" && pathname.startsWith(`${item.href}/`);
  const isActive = isExact || isAncestor;
  const ariaCurrent: "page" | "true" | undefined = isExact
    ? "page"
    : isAncestor
      ? "true"
      : undefined;
  const showBadge = (item.badge ?? 0) > 0;
  return (
    <Link
      key={item.href}
      href={item.href}
      aria-current={ariaCurrent}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-body-lg font-medium transition-colors ${
        isActive
          ? "bg-accent-soft text-accent-text"
          : "text-content-secondary hover:bg-hover hover:text-content"
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className="flex-1">{t(`nav.${item.labelKey}`)}</span>
      {showBadge ? (
        <span
          aria-label={t("nav.unresolvedBadge", { count: item.badge! })}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-caption font-bold text-content-inverse"
        >
          {item.badge}
        </span>
      ) : (
        <LinkPendingSpinner />
      )}
    </Link>
  );
}

interface SidebarProps {
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  /** Viewer's user_id — threaded to the sidebar <Timer> so its author
   *  chip can resolve a stable preset color. */
  userId: string;
  isSystemAdmin?: boolean;
  unresolvedErrorCount?: number;
  /** True when the viewer is owner|admin of at least one business
   *  they can access. Drives whether the Business sidebar entry
   *  renders. Members and contributors don't see it — the surface
   *  exposes compensation, addresses, and other HR data they can
   *  no longer SELECT under the tightened bp_select policy anyway. */
  canManageBusiness?: boolean;
  /** Number of teams the user is a member of. Drives the ambient
   *  team-context chip in the bottom block. */
  teamCount?: number;
  /** When teamCount === 1, the team's display name. Otherwise null
   *  and the chip shows a count instead. */
  primaryTeamName?: string | null;
}

/**
 * Main sidebar — two visible groups (Work + Setup) on top of the
 * three-tier registry (`track` / `manage` / `admin`). Anchored bottom
 * block carries identity, controls, docs, sign-out.
 *
 * Setup-tier entries (Business, Admin) are role-gated:
 *   - Business shows only when the viewer can manage at least one
 *     business (canManageBusiness prop).
 *   - Admin shows for everyone (the hub itself is unprivileged; its
 *     system-admin sub-routes each call requireSystemAdmin()).
 */
export default function Sidebar({
  displayName,
  email,
  userId,
  avatarUrl,
  isSystemAdmin: isAdmin,
  unresolvedErrorCount,
  canManageBusiness,
  teamCount = 0,
  primaryTeamName = null,
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const supabase = createClient();

  // Mobile-only drawer state. The sidebar is hidden by default below
  // the `md` breakpoint and slides in as a fixed overlay when the
  // hamburger is tapped. We close it on link clicks (event delegation
  // on the <aside> below) and on Escape so the user lands on their
  // destination without the drawer covering it.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // "Work" section: shell-level Dashboard + every registered module
  // in the track + manage sections. Reports + Projects now flow
  // through the registry instead of being hardcoded here.
  const workItems: NavItem[] = [
    { labelKey: "dashboard", href: "/", icon: LayoutDashboard },
    ...navItemsForSection("track"),
    ...navItemsForSection("manage"),
  ];

  // "Setup" section: registered setup-tier modules + platform tools
  // (Import). The Business item is filtered out when the viewer can't
  // manage any business — RLS would block them from seeing the
  // people / identity / registrations data the surface displays
  // anyway.
  const setupItems: NavItem[] = navItemsForSection("setup").filter(
    (item) => item.href !== "/business" || canManageBusiness,
  );

  // "System" section: sysadmin-only. Single entry to /system which
  // is the sysadmin hub; sub-routes (errors, users, instance teams,
  // sample data) are reached from there. The unresolved-errors
  // badge lives on this entry — used to live on the old "Admin"
  // entry, which never made sense for non-admins anyway.
  const systemItems: NavItem[] = isAdmin
    ? [
        {
          labelKey: "systemHub",
          href: "/system",
          icon: ShieldAlert,
          badge: unresolvedErrorCount ?? 0,
        },
      ]
    : [];

  // Section-level active state — true when the current pathname is
  // on or under any item in this section. The header gets a subtle
  // emphasis bump so a user landing on /import sees both "Import"
  // (the item highlight) AND "SETUP" (the section header) as
  // signaling "you are here." Per the UX review the bump is
  // intentionally quiet — just one notch up in contrast, no accent
  // color, so it doesn't compete with the loud item-row highlight.
  function itemActive(item: NavItem): boolean {
    if (item.href === "/") return pathname === "/";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  function sectionHeaderClass(active: boolean): string {
    return active
      ? "px-3 pb-1 text-label font-semibold uppercase text-content-secondary"
      : "px-3 pb-1 text-label font-semibold uppercase text-content-muted";
  }
  const isWorkActive = workItems.some(itemActive);
  const isSetupActive = setupItems.some(itemActive);
  const isSystemActive = systemItems.some(itemActive);

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Used by ambient-context affordances (team chip, profile, docs)
  // that don't go through renderNavLink. Truthy when the URL is on or
  // under the given href.
  function isItemActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const version = process.env.NEXT_PUBLIC_APP_VERSION;

  return (
    <>
      {/* Mobile-only hamburger trigger. Hidden on `md+` where the
          sidebar is always visible. Positioned `fixed` so it floats
          above page content even when the user has scrolled. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label={t("nav.openMenu")}
        aria-expanded={mobileOpen}
        aria-controls="primary-sidebar"
        className="md:hidden fixed top-3 left-3 z-40 inline-flex h-10 w-10 items-center justify-center rounded-md border border-edge bg-surface-raised text-content shadow-sm hover:bg-hover"
      >
        <Menu size={18} />
      </button>

      {/* Backdrop. Click to close. Hidden on `md+`. */}
      {mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label={t("nav.closeMenu")}
          className="md:hidden fixed inset-0 z-40 bg-content/30"
        />
      )}

      <aside
        id="primary-sidebar"
        aria-hidden={mobileOpen ? false : undefined}
        onClick={(e) => {
          // Close the mobile drawer when any link inside is clicked
          // — the user is navigating away. md+ has no drawer state to
          // close so this is a cheap no-op there. Event delegation
          // beats wiring an onClick on every Link.
          const target = e.target as HTMLElement | null;
          if (target && target.closest("a[href]")) {
            setMobileOpen(false);
          }
        }}
        className={
          // Mobile: fixed overlay, slides in from the left when open.
          // md+: static, full-height column at 256px.
          "fixed inset-y-0 left-0 z-50 flex h-full w-[256px] flex-col border-r border-edge bg-surface-raised transition-transform duration-200 md:static md:translate-x-0 " +
          (mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")
        }
      >
      {/* Platform brand. The previous version had a marketing tagline
          ("Run your consulting business") under the wordmark — useful
          on first impression, dead weight on every page after, and
          ate ~16px in the bottom-chrome budget. Build version is
          available via the logo tooltip for users who need it. */}
      <Tooltip
        label={
          version ? `${t("appName")} v${version}` : t("appName")
        }
      >
        <Link
          href="/"
          aria-label={t("appName")}
          className="flex items-center gap-3 px-4 py-3 hover:bg-hover transition-colors"
        >
          <Logo size={28} className="text-accent shrink-0" />
          <span className="text-body-lg font-bold text-content tracking-wide">
            {t("appName")}
          </span>
        </Link>
      </Tooltip>

      {/* Ambient team-context chip. Sits right under the wordmark so
          the user always sees which team they're acting in (the
          "way down in the corner" position previously made the chip
          feel disconnected from the page they were operating on).
          Solo (1 team) shows the team name as a static-ish
          indicator confirming the scope; multi-team shows the count
          and clicks through to /teams. There's no global active-
          team state in Shyre today (each list page reads ?org=
          independently via TeamFilter), so this chip is
          informational, not a switcher. */}
      {teamCount > 0 && (
        <Link
          href="/teams"
          aria-label={
            teamCount === 1
              ? `${t("nav.teams")}: ${primaryTeamName ?? ""}`
              : t("nav.teams")
          }
          className={`flex items-center gap-2 border-y border-edge px-4 py-2 text-caption transition-colors hover:bg-hover ${
            isItemActive("/teams")
              ? "bg-accent-soft text-accent-text"
              : "text-content-secondary"
          }`}
        >
          <Building2 size={14} className="shrink-0 text-content-muted" />
          {teamCount === 1 && primaryTeamName ? (
            <span className="truncate flex-1">{primaryTeamName}</span>
          ) : (
            <span className="flex-1">
              {t("nav.teamCount", { count: teamCount })}
            </span>
          )}
          <LinkPendingSpinner />
        </Link>
      )}
      {teamCount === 0 && (
        <div className="border-b border-edge" aria-hidden="true" />
      )}

      {/* Main nav. Three labeled groups (Work / Setup / System) so a
          user landing on any page knows which area they're in without
          having to read item labels. Each group is its own <nav> with
          an aria-label so screen-reader landmark navigation can jump
          between them. The Setup heading was deliberately omitted in
          an earlier iteration when the section had only 2 items; with
          Import promoted to a sidebar entry the section now has 3
          items, and consistent labeling beats the earlier
          "minimum-chrome" call. */}
      {/* Outer container is presentational — each section is its own
          <nav aria-label> landmark below, so a screen reader user can
          jump between Work / Setup / System with the rotor. */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {workItems.length > 0 && (
          <nav
            aria-label={t("navSections.work")}
            className="space-y-0.5"
          >
            <p className={sectionHeaderClass(isWorkActive)}>
              {t("navSections.work")}
            </p>
            {workItems.map((item) => renderNavLink(item, t, pathname))}
          </nav>
        )}
        {setupItems.length > 0 && (
          <nav
            aria-label={t("navSections.setup")}
            className="space-y-0.5 border-t border-edge pt-3"
          >
            <p className={sectionHeaderClass(isSetupActive)}>
              {t("navSections.setup")}
            </p>
            {setupItems.map((item) => renderNavLink(item, t, pathname))}
          </nav>
        )}
        {systemItems.length > 0 && (
          <nav
            aria-label={t("navSections.systemAdmin")}
            className="space-y-0.5 border-t border-edge pt-3"
          >
            <p className={sectionHeaderClass(isSystemActive)}>
              {t("navSections.systemAdmin")}
            </p>
            {systemItems.map((item) => renderNavLink(item, t, pathname))}
          </nav>
        )}
      </div>

      {/* Bottom block — ambient context + identity + controls */}
      <div className="border-t border-edge">
        <Timer
          displayName={displayName}
          avatarUrl={avatarUrl ?? null}
          userId={userId}
        />
      </div>

      {/* Single-row profile + popover trigger. The avatar row used to
          carry a two-line block (display name + email) and was
          followed by separate rows for text-size, theme picker, docs,
          sign-out, and version footer. That stack ate ~140px of
          bottom chrome and pushed nav items off-screen on smaller
          laptops. Collapsed into one row + a popover keyed off the
          avatar following the standard "GitHub / Linear / Notion"
          pattern: avatar opens a menu with the rare actions. The
          email is now reachable via the tooltip on the avatar. */}
      <div className="border-t border-edge">
        <ProfilePopover
          displayName={displayName}
          email={email}
          avatarUrl={avatarUrl ?? null}
          userId={userId}
          isProfileActive={isItemActive("/profile")}
          isDocsActive={isItemActive("/docs")}
          onSignOut={handleSignOut}
        />
      </div>
      </aside>
    </>
  );
}
