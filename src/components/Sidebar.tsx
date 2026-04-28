"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  LogOut,
  BookOpen,
  ShieldAlert,
} from "lucide-react";
import type { ComponentType } from "react";
import Timer from "./Timer";
import { Avatar } from "./Avatar";
import { LinkPendingSpinner } from "./LinkPendingSpinner";
import { TextSizeSwitcher } from "./TextSizeSwitcher";
import { ThemePickerPopover } from "./ThemePickerPopover";
import { Logo } from "./Logo";
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
 *  scaffolding. */
function renderNavLink(
  item: NavItem,
  t: Translator,
  isItemActive: (href: string) => boolean,
): React.JSX.Element {
  const Icon = item.icon;
  const isActive = isItemActive(item.href);
  const showBadge = (item.badge ?? 0) > 0;
  return (
    <Link
      key={item.href}
      href={item.href}
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
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const supabase = createClient();

  // "Work" section: shell-level Dashboard + every registered module
  // in the track + manage sections. Reports + Projects now flow
  // through the registry instead of being hardcoded here.
  const workItems: NavItem[] = [
    { labelKey: "dashboard", href: "/", icon: LayoutDashboard },
    ...navItemsForSection("track"),
    ...navItemsForSection("manage"),
  ];

  // "Setup" section: registered admin-tier modules, role-gated.
  // The Business item is filtered out when the viewer can't manage
  // any business — RLS would block them from seeing the people /
  // identity / registrations data the surface displays anyway.
  const setupItems: NavItem[] = navItemsForSection("admin").filter(
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

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isItemActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  const version = process.env.NEXT_PUBLIC_APP_VERSION;

  return (
    <aside className="flex h-full w-[256px] flex-col border-r border-edge bg-surface-raised">
      {/* Platform brand */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-edge">
        <Logo size={32} className="text-accent shrink-0" />
        <div className="min-w-0">
          <p className="text-body-lg font-bold text-content tracking-wide leading-tight">
            {t("appName")}
          </p>
          <p className="text-caption text-content-muted leading-tight">
            {t("appTagline")}
          </p>
        </div>
      </div>

      {/* Main nav — two visible groups (Work + Setup). Group headings
          use text-label so they read as section markers, not nav
          targets, and don't fight the body-lg item labels for weight.
          Empty sections (e.g. Setup when both Business and Admin are
          hidden) skip their heading too. */}
      <nav
        aria-label={t("nav.primary")}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
      >
        {workItems.length > 0 && (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-label font-semibold uppercase text-content-muted">
              {t("navSections.work")}
            </p>
            {workItems.map((item) => renderNavLink(item, t, isItemActive))}
          </div>
        )}
        {setupItems.length > 0 && (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-label font-semibold uppercase text-content-muted">
              {t("navSections.setup")}
            </p>
            {setupItems.map((item) => renderNavLink(item, t, isItemActive))}
          </div>
        )}
        {systemItems.length > 0 && (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-label font-semibold uppercase text-content-muted">
              {t("navSections.systemAdmin")}
            </p>
            {systemItems.map((item) => renderNavLink(item, t, isItemActive))}
          </div>
        )}
      </nav>

      {/* Bottom block — ambient context + identity + controls */}
      <div className="border-t border-edge">
        <Timer
          displayName={displayName}
          avatarUrl={avatarUrl ?? null}
          userId={userId}
        />
      </div>

      <Link
        href="/profile"
        aria-label={t("nav.profile")}
        className={`group px-4 py-3 border-t border-edge transition-colors hover:bg-hover ${
          isItemActive("/profile") ? "bg-accent-soft" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <Avatar
            avatarUrl={avatarUrl ?? null}
            displayName={displayName}
            size={32}
          />
          <div className="min-w-0 flex-1">
            <p className="text-body-lg font-semibold text-content truncate">
              {displayName}
            </p>
            <p className="text-caption text-content-muted truncate">{email}</p>
          </div>
          <LinkPendingSpinner />
        </div>
      </Link>

      {/* Controls row: text size + theme (language deferred — request.ts
          still hardcodes locale, so a picker would be a placebo). */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-edge">
        <TextSizeSwitcher dense />
        <ThemePickerPopover />
      </div>

      {/* Docs + sign out */}
      <div className="border-t border-edge px-3 py-2 space-y-0.5">
        <Link
          href="/docs"
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-body font-medium transition-colors ${
            isItemActive("/docs")
              ? "bg-accent-soft text-accent-text"
              : "text-content-muted hover:bg-hover hover:text-content"
          }`}
        >
          <BookOpen size={16} className="shrink-0" />
          <span className="flex-1">{t("nav.docs")}</span>
          <LinkPendingSpinner />
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-body font-medium text-content-muted hover:bg-hover hover:text-content transition-colors"
        >
          <LogOut size={16} className="shrink-0" />
          <span className="flex-1 text-left">{t("actions.signOut")}</span>
        </button>
      </div>

      {/* Version — build-time from package.json via next.config.ts */}
      {version && (
        <div className="border-t border-edge px-4 py-2 text-center">
          <span className="text-caption text-content-muted">
            {t("appVersion", { version })}
          </span>
        </div>
      )}
    </aside>
  );
}
