/**
 * Module registry for Shyre.
 *
 * Shyre is the platform shell. Stint (time tracking), Business, Invoicing,
 * Customers, etc. are modules that live alongside each other. A module
 * declares itself here via a manifest — the Sidebar and Settings shell
 * iterate this list instead of hardcoding nav entries.
 *
 * Rules for adding a module:
 *   1. Create `src/app/(dashboard)/<module-root>/` with your pages + actions.
 *   2. Add a manifest to `MODULES` below with your id, label, icon, and
 *      sidebar entries.
 *   3. Module code only calls the shell's platform API (createClient,
 *      getUserContext, getUserTeams, validateTeamAccess, runSafeAction, shared
 *      UI). Modules never import from other modules.
 *   4. DB tables are prefixed by the module when domain-specific
 *      (e.g. `time_entries`, future `business_expenses`). Shell tables
 *      stay unprefixed (`user_profiles`, `teams`, `customers`).
 */

import type { ComponentType } from "react";
import {
  Clock,
  FileText,
  Users,
  Briefcase,
  FolderKanban,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface ModuleNavItem {
  /** i18n key under `nav.*` that resolves to the label */
  labelKey: string;
  /** Absolute route */
  href: string;
  icon: ComponentType<{ size?: number }>;
}

export interface ModuleManifest {
  /** Stable identifier */
  id: string;
  /** i18n key under `modules.*` for the module's display name */
  labelKey: string;
  /** Icon for the module itself (shown in future module-picker) */
  icon: LucideIcon;
  /**
   * Which sidebar section this module's nav entries belong to.
   * "track" (daily work), "manage" (ongoing records), or "admin" (setup).
   */
  section: "track" | "manage" | "admin";
  /** Nav entries contributed by this module */
  navItems: ModuleNavItem[];
}

/**
 * All registered modules, in display order within their section.
 *
 * Keep this list small and meaningful. Modules that haven't been built
 * yet don't get registered (dead nav entries are worse than missing
 * sections).
 */
export const MODULES: ModuleManifest[] = [
  {
    id: "stint",
    labelKey: "modules.stint",
    icon: Clock,
    section: "track",
    navItems: [
      { labelKey: "time", href: "/time-entries", icon: Clock },
    ],
  },
  {
    id: "customers",
    labelKey: "modules.customers",
    icon: Users,
    section: "manage",
    navItems: [
      { labelKey: "customers", href: "/customers", icon: Users },
    ],
  },
  {
    id: "projects",
    labelKey: "modules.projects",
    icon: FolderKanban,
    section: "manage",
    navItems: [
      { labelKey: "projects", href: "/projects", icon: FolderKanban },
    ],
  },
  {
    id: "invoicing",
    labelKey: "modules.invoicing",
    icon: FileText,
    section: "manage",
    navItems: [
      { labelKey: "invoices", href: "/invoices", icon: FileText },
    ],
  },
  {
    id: "reports",
    labelKey: "modules.reports",
    icon: BarChart3,
    section: "manage",
    navItems: [
      { labelKey: "reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    id: "business",
    labelKey: "modules.business",
    icon: Briefcase,
    section: "admin",
    navItems: [
      { labelKey: "business", href: "/business", icon: Briefcase },
    ],
  },
  {
    id: "admin",
    labelKey: "modules.admin",
    icon: Settings,
    section: "admin",
    navItems: [
      { labelKey: "admin", href: "/admin", icon: Settings },
    ],
  },
];

/**
 * Look up a module manifest by id.
 */
export function getModule(id: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.id === id);
}

/**
 * Nav items for a given section, flattened across all modules. Preserves
 * module declaration order.
 */
export function navItemsForSection(
  section: ModuleManifest["section"],
): ModuleNavItem[] {
  return MODULES.filter((m) => m.section === section).flatMap((m) => m.navItems);
}
