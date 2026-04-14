"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Clock,
  Users,
  FolderKanban,
  FileText,
  BarChart3,
  LogOut,
  Building2,
  Shield,
  AlertTriangle,
  Tags,
  Bookmark,
  Upload,
  User as UserIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import Timer from "./Timer";

interface NavItem {
  labelKey: string;
  href: string;
  icon: ComponentType<{ size?: number }>;
}

interface NavSection {
  titleKey?: string;
  items: NavItem[];
}

/**
 * Nav sections (for all users):
 * - Track  : daily work (dashboard, time tracking)
 * - Manage : ongoing records (clients, projects, invoices, reports)
 * - Admin  : org-level admin (organizations, security groups, categories,
 *            templates, data import)
 *
 * Personal user profile lives at /profile (linked from the user identity
 * block at the top of the sidebar).
 *
 * System admin is a separate section rendered below, visible only to
 * system admins.
 */
const sections: NavSection[] = [
  {
    titleKey: "navSections.track",
    items: [
      { labelKey: "dashboard", href: "/", icon: LayoutDashboard },
      { labelKey: "time", href: "/time-entries", icon: Clock },
    ],
  },
  {
    titleKey: "navSections.manage",
    items: [
      { labelKey: "clients", href: "/clients", icon: Users },
      { labelKey: "projects", href: "/projects", icon: FolderKanban },
      { labelKey: "invoices", href: "/invoices", icon: FileText },
      { labelKey: "reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    titleKey: "navSections.admin",
    items: [
      { labelKey: "organizations", href: "/organizations", icon: Building2 },
      { labelKey: "securityGroups", href: "/settings/security-groups", icon: Shield },
      { labelKey: "categories", href: "/settings/categories", icon: Tags },
      { labelKey: "templates", href: "/settings/templates", icon: Bookmark },
      { labelKey: "import", href: "/settings/import", icon: Upload },
    ],
  },
];

const systemAdminItems: NavItem[] = [
  { labelKey: "adminErrors", href: "/admin/errors", icon: AlertTriangle },
  { labelKey: "adminUsers", href: "/admin/users", icon: Users },
  { labelKey: "adminOrgs", href: "/admin/organizations", icon: Building2 },
];

interface SidebarProps {
  displayName: string;
  email: string;
  isSystemAdmin?: boolean;
  unresolvedErrorCount?: number;
}

export default function Sidebar({
  displayName,
  email,
  isSystemAdmin: isAdmin,
  unresolvedErrorCount,
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const supabase = createClient();

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isItemActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-edge bg-surface-raised">
      {/* User identity — clicks to /profile */}
      <Link
        href="/profile"
        aria-label={t("nav.profile")}
        className={`group p-4 border-b border-edge transition-colors hover:bg-hover ${
          isItemActive("/profile") ? "bg-accent-soft" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-content-inverse text-sm font-semibold">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-content truncate">
              {displayName}
            </p>
            <p className="text-xs text-content-muted truncate">{email}</p>
          </div>
          <UserIcon
            size={14}
            className="text-content-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {section.titleKey && (
              <h3 className="px-3 text-[10px] font-semibold uppercase tracking-wider text-content-muted mb-1">
                {t(section.titleKey)}
              </h3>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent-soft text-accent-text"
                      : "text-content-secondary hover:bg-hover hover:text-content"
                  }`}
                >
                  <Icon size={18} />
                  {t(`nav.${item.labelKey}`)}
                </Link>
              );
            })}
          </div>
        ))}

        {/* System admin section — only visible to system admins */}
        {isAdmin && (
          <div className="space-y-1 pt-3 border-t border-edge">
            <h3 className="px-3 text-[10px] font-semibold uppercase tracking-wider text-warning mb-1 flex items-center gap-1">
              <Shield size={10} />
              {t("navSections.systemAdmin")}
            </h3>
            {systemAdminItems.map((item) => {
              const Icon = item.icon;
              const isActive = isItemActive(item.href);
              const showBadge =
                item.href === "/admin/errors" &&
                (unresolvedErrorCount ?? 0) > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-accent-soft text-accent-text"
                      : "text-content-secondary hover:bg-hover hover:text-content"
                  }`}
                >
                  <Icon size={18} />
                  {t(`nav.${item.labelKey}`)}
                  {showBadge && (
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-error text-content-inverse text-[10px] font-bold px-1">
                      {unresolvedErrorCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      <div className="border-t border-edge">
        <Timer />
      </div>

      <div className="border-t border-edge p-4">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-content-muted hover:bg-hover hover:text-content transition-colors w-full"
        >
          <LogOut size={18} />
          {t("actions.signOut")}
        </button>
      </div>
    </aside>
  );
}
