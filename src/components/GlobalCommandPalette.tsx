"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Clock,
  LayoutDashboard,
  Users,
  FolderKanban,
  FileText,
  BarChart3,
  Shield,
  User,
  type LucideIcon,
} from "lucide-react";
import { CommandPalette, useKeyboardShortcut } from "@theshyre/ui";

interface CommandItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Keywords a user might type that should still surface this item. */
  keywords?: string[];
}

interface Props {
  /** Admin destinations surfaced only when the viewer has system-admin. */
  isSystemAdmin: boolean;
}

/**
 * `⌘K` opens a navigate-only command palette. Starts with static
 * destinations (every top-level route) and filters client-side by
 * label + keywords — fast, zero-server-trip for MVP.
 *
 * Future: extend to search customers / projects / invoices by name
 * via a server endpoint (`onQuery` already accepts async results).
 */
export function GlobalCommandPalette({ isSystemAdmin }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const tNav = useTranslations("common.nav");
  const tPalette = useTranslations("common.commandPalette");

  useKeyboardShortcut({
    key: "k",
    meta: true,
    onTrigger: () => setOpen((prev) => !prev),
  });

  const items: CommandItem[] = useMemo(() => {
    const base: CommandItem[] = [
    {
      id: "dashboard",
      label: tNav("dashboard"),
      href: "/",
      icon: LayoutDashboard,
      keywords: ["home"],
    },
    {
      id: "time",
      label: tNav("time"),
      href: "/time-entries",
      icon: Clock,
      keywords: ["timer", "timesheet", "hours", "track"],
    },
    {
      id: "customers",
      label: tNav("customers"),
      href: "/customers",
      icon: Users,
      keywords: ["clients"],
    },
    {
      id: "projects",
      label: tNav("projects"),
      href: "/projects",
      icon: FolderKanban,
    },
    {
      id: "invoices",
      label: tNav("invoices"),
      href: "/invoices",
      icon: FileText,
      keywords: ["bill", "billing"],
    },
    {
      id: "reports",
      label: tNav("reports"),
      href: "/reports",
      icon: BarChart3,
    },
    {
      id: "profile",
      label: tNav("profile"),
      href: "/profile",
      icon: User,
      keywords: ["settings", "preferences", "account"],
    },
  ];
    if (isSystemAdmin) {
      base.push({
        id: "admin",
        label: tNav("admin"),
        href: "/admin",
        icon: Shield,
      });
    }
    return base;
  }, [isSystemAdmin, tNav]);

  const onQuery = useCallback(
    (q: string): CommandItem[] => {
      const needle = q.trim().toLowerCase();
      if (!needle) return items;
      return items.filter((item) => {
        if (item.label.toLowerCase().includes(needle)) return true;
        return item.keywords?.some((k) => k.toLowerCase().includes(needle)) ?? false;
      });
    },
    [items],
  );

  return (
    <CommandPalette<CommandItem>
      open={open}
      onClose={() => setOpen(false)}
      onSelect={(item) => {
        router.push(item.href);
        setOpen(false);
      }}
      onQuery={onQuery}
      getItemKey={(item) => item.id}
      renderItem={(item, selected) => {
        const Icon = item.icon;
        return (
          <div
            className={`flex items-center gap-3 rounded-md px-3 py-2 ${
              selected ? "bg-accent-soft text-accent-text" : "text-content"
            }`}
          >
            <Icon size={16} className="shrink-0 text-content-muted" />
            <span className="flex-1 truncate text-body">{item.label}</span>
          </div>
        );
      }}
      labels={{
        placeholder: tPalette("placeholder"),
        noResults: (q) => tPalette("noResults", { query: q }),
        navigate: tPalette("navigate"),
        select: tPalette("select"),
        toggleHint: tPalette("toggleHint"),
      }}
    />
  );
}
