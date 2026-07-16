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
  UsersRound,
  Briefcase,
  FolderKanban,
  BarChart3,
  Settings,
  Upload,
  FileSignature,
  type LucideIcon,
} from "lucide-react";

/** Sidebar section a nav item belongs to. The label rendered for each
 *  section comes from `common.navSections.<section>` in i18n. */
export type SidebarSection = "track" | "manage" | "setup";

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
   * "track" (daily work), "manage" (ongoing records), or "setup"
   * (per-team configuration + setup operations).
   */
  section: SidebarSection;
  /** Nav entries contributed by this module */
  navItems: ModuleNavItem[];
  /**
   * Team-scoped tables this module owns that emit a live "changed" Broadcast
   * (see the `realtime_team_broadcast` migration + SAL-035). The shell's
   * `<RealtimeTeamSignal>` subscribes to the union of these across modules so
   * background edits surface as a user-controlled refresh. The payload is
   * table-name-only — never row data.
   *
   * Every table listed here MUST have the `broadcast_change` trigger in the
   * migration, and vice-versa — enforced by `realtime-parity.test.ts`. Keep
   * the shell generic: table ownership stays with the module, not hardcoded
   * in the subscriber.
   */
  realtimeTables?: readonly string[];
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
    realtimeTables: ["time_entries"],
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
    realtimeTables: ["invoices"],
  },
  {
    id: "proposals",
    labelKey: "modules.proposals",
    icon: FileSignature,
    section: "manage",
    navItems: [
      { labelKey: "proposals", href: "/proposals", icon: FileSignature },
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
    section: "setup",
    navItems: [
      { labelKey: "business", href: "/business", icon: Briefcase },
    ],
    realtimeTables: ["expenses"],
  },
  {
    id: "teams",
    labelKey: "modules.teams",
    icon: UsersRound,
    section: "setup",
    navItems: [
      { labelKey: "teams", href: "/teams", icon: UsersRound },
    ],
  },
  {
    id: "settings",
    labelKey: "modules.admin",
    icon: Settings,
    section: "setup",
    navItems: [
      { labelKey: "admin", href: "/settings", icon: Settings },
    ],
  },
];

/**
 * Platform tools — sidebar entries that don't belong to a single module
 * because they cross-cut multiple verticals.
 *
 * Import is the canonical example: it writes into Stint's `time_entries`
 * AND Business expenses AND (future) Invoicing rows AND Customers. Its
 * `import_runs` ledger is shell-owned, not vertical-owned. Modeling it
 * as a `ModuleManifest` would relax the meaning of "module" to
 * "anything with a sidebar entry," and the next sysadmin tool / billing
 * console / feature-flag panel would inherit the same shape.
 *
 * Renders alongside module nav items via `navItemsForSection` so the
 * sidebar doesn't care which list contributed an entry.
 */
export const PLATFORM_TOOLS: Array<{
  id: string;
  section: SidebarSection;
  navItem: ModuleNavItem;
}> = [
  {
    id: "import",
    section: "setup",
    navItem: { labelKey: "import", href: "/import", icon: Upload },
  },
];

/**
 * Look up a module manifest by id.
 */
export function getModule(id: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.id === id);
}

/**
 * Every team-scoped table across all modules that emits a live-change
 * Broadcast. The shell's `<RealtimeTeamSignal>` uses this to know what to
 * listen for without reaching into any module's schema; the DB triggers that
 * back it are kept in parity by `realtime-parity.test.ts`. Sorted + de-duped
 * for stable comparisons.
 */
export function realtimeWatchedTables(): string[] {
  return [...new Set(MODULES.flatMap((m) => m.realtimeTables ?? []))].sort();
}

/**
 * Nav items for a given section, flattened across modules + platform
 * tools. Preserves declaration order within each list (modules first,
 * then platform tools) so the sidebar layout stays predictable.
 */
export function navItemsForSection(
  section: SidebarSection,
): ModuleNavItem[] {
  const fromModules = MODULES.filter((m) => m.section === section).flatMap(
    (m) => m.navItems,
  );
  const fromPlatformTools = PLATFORM_TOOLS.filter(
    (t) => t.section === section,
  ).map((t) => t.navItem);
  return [...fromModules, ...fromPlatformTools];
}
