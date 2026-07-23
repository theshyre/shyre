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
 *
 * Not everything with a nav entry is a module: always-on platform
 * pages (Dashboard, Teams, Settings, Profile, Docs, System) are
 * SHELL_SURFACES, and cross-cutting verticals (Import) are
 * PLATFORM_TOOLS — see those exports below.
 */

import type { ComponentType } from "react";
import {
  BarChart3,
  BookOpen,
  Bookmark,
  Briefcase,
  Clock,
  FileCheck2,
  FileSignature,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Plug,
  Settings,
  ShieldAlert,
  Tags,
  Upload,
  User,
  Users,
  UsersRound,
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
   * Settings-hub-only entries contributed by this module — rendered as
   * cards on `/settings` (see `SettingsHubPage`), never in the main
   * sidebar nav. Distinct from `navItems`: a module can have
   * settings-only surfaces (Stint's Categories/Templates config) or,
   * conversely, own settings surfaces without any top-level sidebar
   * presence at all (`navItems: []`) — see the "integrations" entry
   * below. `labelKey` here is looked up under `admin.hub.cards.*`
   * (title + description) by the settings hub, not `nav.*` like a
   * regular navItem.
   */
  settingsEntries?: ModuleNavItem[];
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
    settingsEntries: [
      { labelKey: "categories", href: "/categories", icon: Tags },
      { labelKey: "templates", href: "/templates", icon: Bookmark },
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
    realtimeTables: ["proposals"],
    section: "manage",
    navItems: [
      { labelKey: "proposals", href: "/proposals", icon: FileSignature },
    ],
  },
  {
    id: "signoff",
    labelKey: "modules.signoff",
    icon: FileCheck2,
    section: "manage",
    navItems: [
      { labelKey: "signoffs", href: "/signoffs", icon: FileCheck2 },
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
    // Integrations owns its own tables (integration_tokens, etc. —
    // see src/lib/integrations/) and routes, but has no top-level
    // sidebar presence: it's reached only through the Settings hub
    // card, exactly as before this module existed in the registry.
    // `navItems: []` is deliberate — it contributes nothing to
    // `navItemsForSection`/the sidebar/the command palette, only a
    // `settingsEntries` card.
    id: "integrations",
    labelKey: "modules.integrations",
    icon: Plug,
    section: "setup",
    navItems: [],
    settingsEntries: [
      { labelKey: "integrations", href: "/settings/integrations", icon: Plug },
    ],
  },
];

/**
 * Where a shell surface renders in the chrome:
 *   - `"home"`      — head of the sidebar's Work section + first
 *                     palette entry (the Dashboard).
 *   - a SidebarSection — merged into that section's nav list right
 *                     after the modules (Teams + Settings in "setup").
 *   - `"identity"`  — the profile-popover / palette tail cluster
 *                     (Profile, Docs); not part of the main nav.
 *   - `"system"`    — the sysadmin-only System group.
 */
export type ShellPlacement = SidebarSection | "home" | "identity" | "system";

/**
 * An always-on platform page. Shell surfaces are NOT modules: they
 * can't be toggled off, they own no vertical domain, and modeling
 * them as `ModuleManifest`s would dilute what "module" means (Teams
 * and Settings used to be shoehorned into `MODULES` exactly that
 * way). Consumers (Sidebar, GlobalCommandPalette, breadcrumb parity
 * tests) derive these entries from here instead of hardcoding them.
 */
export interface ShellSurface {
  /** Stable identifier — also the command-palette item id. */
  id: string;
  /** Where the surface renders (see {@link ShellPlacement}). */
  placement: ShellPlacement;
  navItem: ModuleNavItem;
  /** Only rendered for system admins (e.g. /system). Callers supply
   *  the viewer's admin flag; the registry just declares the gate. */
  requiresSystemAdmin?: boolean;
}

/**
 * Always-on shell surfaces, in display order within their placement.
 */
export const SHELL_SURFACES: ShellSurface[] = [
  {
    id: "dashboard",
    placement: "home",
    navItem: { labelKey: "dashboard", href: "/", icon: LayoutDashboard },
  },
  {
    id: "teams",
    placement: "setup",
    navItem: { labelKey: "teams", href: "/teams", icon: UsersRound },
  },
  {
    id: "settings",
    placement: "setup",
    navItem: { labelKey: "admin", href: "/settings", icon: Settings },
  },
  {
    id: "profile",
    placement: "identity",
    navItem: { labelKey: "profile", href: "/profile", icon: User },
  },
  {
    id: "docs",
    placement: "identity",
    navItem: { labelKey: "docs", href: "/docs", icon: BookOpen },
  },
  {
    id: "systemHub",
    placement: "system",
    navItem: { labelKey: "systemHub", href: "/system", icon: ShieldAlert },
    requiresSystemAdmin: true,
  },
];

/**
 * Shell surfaces for a placement, in declaration order.
 */
export function shellSurfacesForPlacement(
  placement: ShellPlacement,
): ShellSurface[] {
  return SHELL_SURFACES.filter((s) => s.placement === placement);
}

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
 * Nav items for a given section, flattened across modules + shell
 * surfaces + platform tools. Preserves declaration order within each
 * list (modules first, then shell surfaces, then platform tools) so
 * the sidebar layout stays predictable — for "setup" that yields
 * Business, Teams, Settings, Import, exactly the pre-SHELL_SURFACES
 * order.
 */
export function navItemsForSection(
  section: SidebarSection,
): ModuleNavItem[] {
  const fromModules = MODULES.filter((m) => m.section === section).flatMap(
    (m) => m.navItems,
  );
  const fromShellSurfaces = SHELL_SURFACES.filter(
    (s) => s.placement === section,
  ).map((s) => s.navItem);
  const fromPlatformTools = PLATFORM_TOOLS.filter(
    (t) => t.section === section,
  ).map((t) => t.navItem);
  return [...fromModules, ...fromShellSurfaces, ...fromPlatformTools];
}
