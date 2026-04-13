"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Clock,
  List,
  Users,
  FolderKanban,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  User,
  Building2,
  Shield,
} from "lucide-react";
import type { ComponentType } from "react";
import Timer from "./Timer";

interface NavItem {
  labelKey: string;
  href: string;
  icon: ComponentType<{ size?: number }>;
}

const nav: NavItem[] = [
  { labelKey: "dashboard", href: "/", icon: LayoutDashboard },
  { labelKey: "timer", href: "/timer", icon: Clock },
  { labelKey: "timeEntries", href: "/time-entries", icon: List },
  { labelKey: "clients", href: "/clients", icon: Users },
  { labelKey: "projects", href: "/projects", icon: FolderKanban },
  { labelKey: "invoices", href: "/invoices", icon: FileText },
  { labelKey: "reports", href: "/reports", icon: BarChart3 },
  { labelKey: "organizations", href: "/organizations", icon: Building2 },
  { labelKey: "settings", href: "/settings", icon: Settings },
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

  return (
    <aside className="flex h-full w-64 flex-col border-r border-edge bg-surface-raised">
      {/* User identity */}
      <div className="p-4 border-b border-edge">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-content-inverse text-sm font-semibold">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-content truncate">
              {displayName}
            </p>
            <p className="text-xs text-content-muted truncate">{email}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-3">
        {nav.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
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
              <Icon size={20} />
              {t(`nav.${item.labelKey}`)}
            </Link>
          );
        })}

        {isAdmin && (
          <Link
            href="/admin/errors"
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              pathname.startsWith("/admin")
                ? "bg-accent-soft text-accent-text"
                : "text-content-secondary hover:bg-hover hover:text-content"
            }`}
          >
            <Shield size={20} />
            Admin
            {(unresolvedErrorCount ?? 0) > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-error text-content-inverse text-[10px] font-bold px-1">
                {unresolvedErrorCount}
              </span>
            )}
          </Link>
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
          <LogOut size={20} />
          {t("actions.signOut")}
        </button>
      </div>
    </aside>
  );
}
