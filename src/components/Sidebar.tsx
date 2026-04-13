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
  Plus,
  Check,
  User as UserIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { OrgListItem } from "@/lib/org-context";
import Timer from "./Timer";
import { switchOrgAction } from "@/app/(dashboard)/switch-org/actions";
import { createOrgAction } from "@/app/(dashboard)/organizations/actions";
import { inputClass, buttonPrimaryClass, buttonSecondaryClass } from "@/lib/form-styles";

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
  orgs: OrgListItem[];
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setShowCreateForm(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [dropdownOpen]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        setShowCreateForm(false);
      }
    }
    if (dropdownOpen) {
      window.addEventListener("keydown", handleKey);
      return () => window.removeEventListener("keydown", handleKey);
    }
  }, [dropdownOpen]);

  return (
    <aside className="flex h-full w-64 flex-col border-r border-edge bg-surface-raised">
      {/* Org switcher */}
      <div ref={dropdownRef} className="relative p-4 border-b border-edge">
        <button
          onClick={() => {
            setDropdownOpen(!dropdownOpen);
            setShowCreateForm(false);
          }}
          className="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-left hover:bg-hover transition-colors"
        >
          <Building2 size={18} className="text-accent shrink-0" />
          <span className="text-sm font-semibold text-content truncate flex-1">
            {orgName}
          </span>
          <ChevronDown
            size={14}
            className={`text-content-muted shrink-0 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
          />
        </button>

        {dropdownOpen && (
          <div className="absolute left-2 right-2 top-full z-30 mt-1 rounded-lg border border-edge bg-surface-raised shadow-lg overflow-hidden">
            {/* Org list */}
            <div className="max-h-48 overflow-y-auto">
              {orgs.map((org) => (
                <form key={org.id} action={switchOrgAction}>
                  <input type="hidden" name="org_id" value={org.id} />
                  <button
                    type="submit"
                    className={`flex items-center gap-2 w-full px-3 py-2.5 text-sm text-left transition-colors ${
                      org.id === orgId
                        ? "bg-accent-soft text-accent-text"
                        : "text-content-secondary hover:bg-hover"
                    }`}
                    onClick={() => setDropdownOpen(false)}
                  >
                    {org.id === orgId ? (
                      <Check size={14} className="shrink-0" />
                    ) : (
                      <Building2 size={14} className="shrink-0 text-content-muted" />
                    )}
                    <span className="truncate flex-1">{org.name}</span>
                    <span className="flex items-center gap-1 text-[10px] text-content-muted">
                      {org.isPersonal && (
                        <UserIcon size={10} />
                      )}
                      {org.role}
                    </span>
                  </button>
                </form>
              ))}
            </div>

            {/* Divider + Create org */}
            <div className="border-t border-edge">
              {showCreateForm ? (
                <form
                  action={async (formData) => {
                    await createOrgAction(formData);
                    setDropdownOpen(false);
                    setShowCreateForm(false);
                  }}
                  className="p-3 space-y-2"
                >
                  <input
                    name="org_name"
                    required
                    placeholder={t("org.namePlaceholder")}
                    autoFocus
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <button type="submit" className={`${buttonPrimaryClass} text-xs py-1.5`}>
                      {t("org.create")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className={`${buttonSecondaryClass} text-xs py-1.5`}
                    >
                      {t("actions.cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-content-secondary hover:bg-hover transition-colors"
                >
                  <Plus size={14} />
                  {t("org.create")}
                </button>
              )}
            </div>
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
