/**
 * Breadcrumb metadata registry.
 *
 * Maps URL path patterns to a trail of breadcrumb segments. Each route
 * declares its own full trail (Setup › Business › <name> › People)
 * rather than nesting structurally — the URL's path hierarchy and the
 * breadcrumb's IA hierarchy aren't always the same. Categories and
 * Templates, for example, are reached *from* Settings but live at
 * top-level URLs (/categories, /templates).
 *
 * Each segment is either:
 *   - **Static**: `{ labelKey, href }` — translated via i18n; href can
 *     be null for structural segments like "Setup" that group items
 *     but don't navigate anywhere.
 *   - **Dynamic**: `{ resolver, href }` — a registered async resolver
 *     fetches the human label (e.g. business name for `[businessId]`).
 *     Resolvers return `null` on permission failure / missing row, and
 *     the renderer falls back to a generic label.
 *
 * Pattern matching uses Next.js-style placeholders: `[paramName]`.
 * The walk extracts params from the URL and substitutes them into
 * each segment's href before rendering.
 *
 * Adding a new route: add a `ROUTE` entry. The registry-walk regression
 * test catches missing entries for any registered top-level page.
 */

export type DynamicResolverKey = "businessName" | "teamName" | "customerName";

export interface BreadcrumbSegmentSpec {
  /** Stable id for tests / debugging. */
  id: string;
  /** i18n key under `breadcrumb.*`. Mutually exclusive with `resolver`. */
  labelKey?: string;
  /** Async lookup name when this segment is `[entityId]`. The
   *  registered resolver receives the matched params and returns the
   *  human label or null. Mutually exclusive with `labelKey`. */
  resolver?: DynamicResolverKey;
  /** Param name to feed the resolver. Required when `resolver` is set. */
  resolverParam?: string;
  /** Href template with [param] placeholders. `null` marks a
   *  structural segment that renders as plain text (no link). */
  href: string | null;
}

export interface BreadcrumbRouteSpec {
  /** Path pattern with [paramName] placeholders. Match priority is
   *  longest pattern wins (so /business/[id]/people beats /business/[id]). */
  pattern: string;
  trail: BreadcrumbSegmentSpec[];
}

/**
 * The trail registry. Order doesn't matter for matching (we sort by
 * specificity at lookup time) but keeping siblings adjacent makes
 * audits easier.
 *
 * Convention: structural segments ("Setup") use `href: null` so the
 * renderer outputs them as plain text instead of a link. Item segments
 * point at the URL the user reaches by clicking.
 */
export const BREADCRUMB_ROUTES: BreadcrumbRouteSpec[] = [
  // /import
  {
    pattern: "/import",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "import", labelKey: "import", href: "/import" },
    ],
  },

  // /business and children
  {
    pattern: "/business",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "business", labelKey: "business", href: "/business" },
    ],
  },
  {
    pattern: "/business/[businessId]",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "business", labelKey: "business", href: "/business" },
      {
        id: "businessName",
        resolver: "businessName",
        resolverParam: "businessId",
        href: "/business/[businessId]",
      },
    ],
  },
  {
    pattern: "/business/[businessId]/identity",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "business", labelKey: "business", href: "/business" },
      {
        id: "businessName",
        resolver: "businessName",
        resolverParam: "businessId",
        href: "/business/[businessId]",
      },
      { id: "identity", labelKey: "businessIdentity", href: "/business/[businessId]/identity" },
    ],
  },
  {
    pattern: "/business/[businessId]/people",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "business", labelKey: "business", href: "/business" },
      {
        id: "businessName",
        resolver: "businessName",
        resolverParam: "businessId",
        href: "/business/[businessId]",
      },
      { id: "people", labelKey: "businessPeople", href: "/business/[businessId]/people" },
    ],
  },
  {
    pattern: "/business/[businessId]/expenses",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "business", labelKey: "business", href: "/business" },
      {
        id: "businessName",
        resolver: "businessName",
        resolverParam: "businessId",
        href: "/business/[businessId]",
      },
      { id: "expenses", labelKey: "businessExpenses", href: "/business/[businessId]/expenses" },
    ],
  },
  {
    pattern: "/business/[businessId]/period-locks",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "business", labelKey: "business", href: "/business" },
      {
        id: "businessName",
        resolver: "businessName",
        resolverParam: "businessId",
        href: "/business/[businessId]",
      },
      { id: "periodLocks", labelKey: "businessPeriodLocks", href: "/business/[businessId]/period-locks" },
    ],
  },

  // /settings and reachable-from-settings surfaces
  {
    pattern: "/settings",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "settings", labelKey: "settings", href: "/settings" },
    ],
  },
  {
    pattern: "/teams",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "settings", labelKey: "settings", href: "/settings" },
      { id: "teams", labelKey: "teams", href: "/teams" },
    ],
  },
  {
    pattern: "/teams/[teamId]",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "settings", labelKey: "settings", href: "/settings" },
      { id: "teams", labelKey: "teams", href: "/teams" },
      {
        id: "teamName",
        resolver: "teamName",
        resolverParam: "teamId",
        href: "/teams/[teamId]",
      },
    ],
  },
  {
    pattern: "/categories",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "settings", labelKey: "settings", href: "/settings" },
      { id: "categories", labelKey: "categories", href: "/categories" },
    ],
  },
  {
    pattern: "/templates",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "settings", labelKey: "settings", href: "/settings" },
      { id: "templates", labelKey: "templates", href: "/templates" },
    ],
  },
  {
    pattern: "/security-groups",
    trail: [
      { id: "setup", labelKey: "setup", href: null },
      { id: "settings", labelKey: "settings", href: "/settings" },
      { id: "securityGroups", labelKey: "securityGroups", href: "/security-groups" },
    ],
  },

  // /profile + sub-pages
  {
    pattern: "/profile",
    trail: [{ id: "profile", labelKey: "profile", href: "/profile" }],
  },

  // /system + sub-pages
  {
    pattern: "/system",
    trail: [{ id: "system", labelKey: "system", href: "/system" }],
  },
  {
    pattern: "/system/errors",
    trail: [
      { id: "system", labelKey: "system", href: "/system" },
      { id: "systemErrors", labelKey: "systemErrors", href: "/system/errors" },
    ],
  },
  {
    pattern: "/system/users",
    trail: [
      { id: "system", labelKey: "system", href: "/system" },
      { id: "systemUsers", labelKey: "systemUsers", href: "/system/users" },
    ],
  },
  {
    pattern: "/system/teams",
    trail: [
      { id: "system", labelKey: "system", href: "/system" },
      { id: "systemTeams", labelKey: "systemTeams", href: "/system/teams" },
    ],
  },
  {
    pattern: "/system/sample-data",
    trail: [
      { id: "system", labelKey: "system", href: "/system" },
      { id: "systemSampleData", labelKey: "systemSampleData", href: "/system/sample-data" },
    ],
  },
];
