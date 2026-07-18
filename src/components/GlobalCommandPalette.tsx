"use client";

import { useCallback, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  LayoutDashboard,
  ShieldAlert,
  User,
} from "lucide-react";
import { CommandPalette, useKeyboardShortcut } from "@theshyre/ui";
import { navItemsForSection } from "@/lib/modules/registry";

interface CommandItem {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Keywords a user might type that should still surface this item. */
  keywords?: string[];
}

interface Props {
  /** System hub surfaced only when the viewer has system-admin. */
  isSystemAdmin: boolean;
  /** Mirrors the sidebar's /business gating — owner/admin on ≥1 team. */
  canManageBusiness: boolean;
}

/** Search synonyms per destination. Keyed by href so registry additions
 *  work with zero entries here (label matching still applies). */
const KEYWORDS: Record<string, string[]> = {
  "/": ["home"],
  "/time-entries": ["timer", "timesheet", "hours", "track"],
  "/customers": ["clients"],
  "/invoices": ["bill", "billing"],
  "/proposals": ["quote", "sign-off", "pipeline"],
  "/business": ["expenses", "people", "registrations"],
  "/teams": ["members", "organization"],
  "/settings": ["preferences"],
  "/import": ["harvest", "csv"],
  "/profile": ["settings", "preferences", "account"],
  "/docs": ["help", "guide", "documentation"],
  "/system": ["admin", "errors", "users"],
};

/**
 * `⌘K` opens a navigate-only command palette. Destinations DERIVE from
 * the module registry (the same source the sidebar renders from), so a
 * newly registered module is searchable with zero palette changes —
 * previously this was a parallel hardcoded list that drifted (it was
 * missing Proposals/Teams/Business entirely and pointed "Admin" at a
 * dead /admin URL).
 *
 * Future: extend to search customers / projects / invoices by name
 * via a server endpoint (`onQuery` already accepts async results).
 */
export function GlobalCommandPalette({
  isSystemAdmin,
  canManageBusiness,
}: Props): React.JSX.Element {
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
    // Mirror the sidebar's composition: shell Dashboard + registered
    // modules (track/manage/setup, with the same /business gate) +
    // shell surfaces (profile, docs) + the sysadmin hub.
    const registryItems = [
      ...navItemsForSection("track"),
      ...navItemsForSection("manage"),
      ...navItemsForSection("setup").filter(
        (item) => item.href !== "/business" || canManageBusiness,
      ),
    ];
    const base: CommandItem[] = [
      {
        id: "dashboard",
        label: tNav("dashboard"),
        href: "/",
        icon: LayoutDashboard,
        keywords: KEYWORDS["/"],
      },
      ...registryItems.map((item) => ({
        id: item.labelKey,
        label: tNav(item.labelKey),
        href: item.href,
        icon: item.icon,
        keywords: KEYWORDS[item.href],
      })),
      {
        id: "profile",
        label: tNav("profile"),
        href: "/profile",
        icon: User,
        keywords: KEYWORDS["/profile"],
      },
      {
        id: "docs",
        label: tNav("docs"),
        href: "/docs",
        icon: BookOpen,
        keywords: KEYWORDS["/docs"],
      },
    ];
    if (isSystemAdmin) {
      base.push({
        id: "systemHub",
        label: tNav("systemHub"),
        href: "/system",
        icon: ShieldAlert,
        keywords: KEYWORDS["/system"],
      });
    }
    return base;
  }, [isSystemAdmin, canManageBusiness, tNav]);

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
