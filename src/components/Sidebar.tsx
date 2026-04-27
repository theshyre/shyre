"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  FolderKanban,
  BarChart3,
  LogOut,
  Settings,
  BookOpen,
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

interface SidebarProps {
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  /** Viewer's user_id — threaded to the sidebar <Timer> so its author
   *  chip can resolve a stable preset color. */
  userId: string;
  isSystemAdmin?: boolean;
  unresolvedErrorCount?: number;
}

/**
 * Main sidebar. Flat 7-item nav + anchored bottom block — matches Liv's
 * structure so the two apps share a consistent shape. Section dividers
 * were dropped because with 7 items the order alone communicates hierarchy.
 *
 * Sub-surfaces previously listed directly in the sidebar (Business, Teams,
 * Security Groups, Categories, Templates, Import) now live under the
 * /admin hub page. System-admin-only tooling is a second section on the
 * same hub page, gated by requireSystemAdmin in each sub-route.
 */
export default function Sidebar({
  displayName,
  email,
  userId,
  avatarUrl,
  isSystemAdmin: isAdmin,
  unresolvedErrorCount,
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const supabase = createClient();

  // Main nav: registry-contributed items from track + manage, then shell
  // cross-cutting entries, then Admin as the final hub entry.
  const trackItems = navItemsForSection("track");
  const manageItems = navItemsForSection("manage");

  const mainItems: NavItem[] = [
    { labelKey: "dashboard", href: "/", icon: LayoutDashboard },
    ...trackItems,
    ...manageItems,
    { labelKey: "projects", href: "/projects", icon: FolderKanban },
    { labelKey: "reports", href: "/reports", icon: BarChart3 },
    {
      labelKey: "admin",
      href: "/admin",
      icon: Settings,
      // Badge is safe to render for non-admins too (will be 0 / hidden),
      // but we only pass a non-zero value from the dashboard layout when
      // the user is a system admin.
      badge: isAdmin ? (unresolvedErrorCount ?? 0) : 0,
    },
  ];

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

      {/* Main nav — flat, no section dividers */}
      <nav
        aria-label={t("nav.primary")}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5"
      >
        {mainItems.map((item) => {
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
        })}
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
