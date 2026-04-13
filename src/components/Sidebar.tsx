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
  Building2,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import type { ComponentType } from "react";
import Timer from "./Timer";
import { switchOrgAction } from "@/app/(dashboard)/switch-org/actions";

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
  { labelKey: "settings", href: "/settings", icon: Settings },
];

interface SidebarProps {
  orgName: string;
  orgId: string;
  role: string;
  orgs: Array<{ id: string; name: string; slug: string; role: string }>;
}

export default function Sidebar({
  orgName,
  orgId,
  role,
  orgs,
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("common");
  const supabase = createClient();
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-edge bg-surface-raised">
      {/* Org switcher */}
      <div className="relative p-4 border-b border-edge">
        <button
          onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
          className="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-left hover:bg-hover transition-colors"
        >
          <Building2 size={18} className="text-accent shrink-0" />
          <span className="text-sm font-semibold text-content truncate flex-1">
            {orgName}
          </span>
          {orgs.length > 1 && (
            <ChevronDown size={14} className="text-content-muted shrink-0" />
          )}
        </button>

        {orgDropdownOpen && orgs.length > 1 && (
          <div className="absolute left-2 right-2 top-full z-30 mt-1 rounded-lg border border-edge bg-surface-raised shadow-lg">
            {orgs.map((org) => (
              <form key={org.id} action={switchOrgAction}>
                <input type="hidden" name="org_id" value={org.id} />
                <button
                  type="submit"
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors ${
                    org.id === orgId
                      ? "bg-accent-soft text-accent-text"
                      : "text-content-secondary hover:bg-hover"
                  }`}
                  onClick={() => setOrgDropdownOpen(false)}
                >
                  <Building2 size={14} />
                  <span className="truncate">{org.name}</span>
                  <span className="ml-auto text-xs text-content-muted">
                    {org.role}
                  </span>
                </button>
              </form>
            ))}
          </div>
        )}
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
