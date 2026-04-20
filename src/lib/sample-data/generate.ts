/**
 * Deterministic sample-data generator for the /admin/sample-data tool.
 *
 * Produces a realistic spread of a small consulting practice's data —
 * customers, projects, per-member rates, categorized time entries, and
 * both draft and sent invoices — exercising the rate-visibility,
 * rate-editability, and time-entries-visibility models shipped in
 * Phases 2a–3.
 *
 * Same (seed, now) → same output, so repeat loads feel familiar and
 * the test file can pin counts.
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export type RateLevel = "owner" | "admins" | "all_members";
export type MemberRateLevel = "owner" | "admins" | "self" | "all_members";
export type TimeEntriesLevel = "own_only" | "read_all" | "read_write_all";

export interface SampleTeamMember {
  /** Human-readable name used for the avatar + display_name. */
  displayName: string;
  /** Deterministic slug for the email prefix. */
  slug: string;
  role: "admin" | "member";
  default_rate: number | null;
  rate_visibility: MemberRateLevel;
  rate_editability: MemberRateLevel;
}

export interface SampleTeamSettings {
  rate_visibility: RateLevel;
  rate_editability: RateLevel;
  time_entries_visibility: TimeEntriesLevel;
  admins_can_set_rate_permissions: boolean;
}

export interface SampleCustomer {
  name: string;
  email: string | null;
  default_rate: number | null;
  notes: string | null;
  rate_visibility: RateLevel;
  rate_editability: RateLevel;
}

export interface SampleProject {
  /** Index into SampleData.customers, or null for an internal project. */
  customerIndex: number | null;
  name: string;
  description: string | null;
  hourly_rate: number | null;
  github_repo: string | null;
  status: "active" | "paused" | "completed";
  rate_visibility: RateLevel;
  rate_editability: RateLevel;
  /** NULL means inherit team default. */
  time_entries_visibility: TimeEntriesLevel | null;
  /**
   * Which category set (if any) this project uses as its base. Values:
   *   - null       → project has NO category set (uncategorized entries only)
   *   - "base"     → inherits the team-level base set
   *   - a set name → inherits that specific named set
   * The project-scoped extension (if any) is attached via extendsProjectName.
   */
  baseCategorySet: string | null;
  /**
   * When true, time entries on this project require explicit start + end
   * timestamps. Default in real Shyre use is false — most consulting work
   * is logged as "date + duration". We keep exactly one sample project
   * with `true` so the timestamp-mode path is still exercised.
   */
  require_timestamps: boolean;
}

export interface SampleCategorySet {
  /** Stable name used to resolve refs. */
  name: string;
  /**
   * "team" = team-scoped base set (project_id null, team_id set)
   * "project" = project-scoped extension (project_id set, team_id null)
   */
  scope: "team" | "project";
  /** For scope=project: which project (by name) this set extends. */
  extendsProjectName: string | null;
  description: string | null;
}

export interface SampleCategory {
  /** Name of the category_set this belongs to. */
  setName: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface SampleEntry {
  /** Index into SampleData.projects. */
  projectIndex: number;
  /** Index into SampleData.teamMembers, or null for the caller. */
  memberIndex: number | null;
  /** ISO timestamp. */
  startIso: string;
  /** ISO timestamp. */
  endIso: string;
  description: string | null;
  billable: boolean;
  github_issue: number | null;
  /**
   * Category set name + category name if this entry is categorized.
   * Null means uncategorized.
   */
  categoryRef: { setName: string; categoryName: string } | null;
}

export interface SampleInvoice {
  customerIndex: number;
  status: "draft" | "sent";
  /** Inclusive: invoice all billable, un-invoiced entries in this window for this customer. */
  windowDays: { from: number; to: number };
  notes: string | null;
  invoice_number_suffix: string;
  due_days: number | null;
}

export interface SampleExpense {
  /** YYYY-MM-DD */
  incurredOn: string;
  /** Dollars (2 decimal precision). */
  amount: number;
  currency: string;
  vendor: string | null;
  category:
    | "software"
    | "hardware"
    | "subscriptions"
    | "travel"
    | "meals"
    | "office"
    | "professional_services"
    | "fees"
    | "other";
  description: string | null;
  /** Index into SampleData.projects, or null for unassigned. */
  projectIndex: number | null;
  billable: boolean;
}

export interface SampleBusinessIdentity {
  legal_name: string;
  entity_type:
    | "sole_prop"
    | "llc"
    | "s_corp"
    | "c_corp"
    | "partnership"
    | "nonprofit"
    | "other";
  tax_id: string;
  date_incorporated: string;
  fiscal_year_start: string;
  display_name: string;
}

export interface SampleRegisteredAgent {
  /** Stable key to resolve the FK when inserting state registrations. */
  key: string;
  name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
}

export interface SampleStateRegistration {
  state: string;
  is_formation: boolean;
  registration_type: "domestic" | "foreign_qualification";
  entity_number: string | null;
  state_tax_id: string | null;
  registered_on: string | null;
  nexus_start_date: string | null;
  registration_status:
    | "pending"
    | "active"
    | "delinquent"
    | "withdrawn"
    | "revoked";
  report_frequency: "annual" | "biennial" | "decennial" | null;
  due_rule: "fixed_date" | "anniversary" | "quarter_end" | null;
  annual_report_due_mmdd: string | null;
  annual_report_fee_cents: number | null;
  /** References SampleRegisteredAgent.key. */
  agentKey: string | null;
  notes: string | null;
}

export interface SampleData {
  teamSettings: SampleTeamSettings;
  businessIdentity: SampleBusinessIdentity;
  registeredAgents: SampleRegisteredAgent[];
  stateRegistrations: SampleStateRegistration[];
  teamMembers: SampleTeamMember[];
  customers: SampleCustomer[];
  projects: SampleProject[];
  categorySets: SampleCategorySet[];
  categories: SampleCategory[];
  entries: SampleEntry[];
  invoices: SampleInvoice[];
  expenses: SampleExpense[];
}

// ────────────────────────────────────────────────────────────────
// PRNG + pickers
// ────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  const idx = Math.floor(rng() * arr.length);
  return arr[idx] as T;
}

function pickWeighted<T>(
  rng: () => number,
  choices: ReadonlyArray<readonly [T, number]>,
): T {
  const total = choices.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, weight] of choices) {
    r -= weight;
    if (r <= 0) return value;
  }
  return choices[choices.length - 1]![0];
}

// ────────────────────────────────────────────────────────────────
// Seed material
// ────────────────────────────────────────────────────────────────

const TEAM_SETTINGS_SEED: SampleTeamSettings = {
  rate_visibility: "all_members",
  rate_editability: "admins",
  time_entries_visibility: "read_all",
  admins_can_set_rate_permissions: true,
};

const TEAM_MEMBER_SEED: ReadonlyArray<SampleTeamMember> = [
  {
    displayName: "Jordan Patel",
    slug: "jordan",
    role: "admin",
    default_rate: 175,
    rate_visibility: "admins",
    rate_editability: "owner",
  },
  {
    displayName: "Riley Kim",
    slug: "riley",
    role: "member",
    default_rate: 125,
    rate_visibility: "self",
    rate_editability: "owner",
  },
  {
    displayName: "Morgan Lee",
    slug: "morgan",
    role: "member",
    default_rate: 150,
    rate_visibility: "owner",
    rate_editability: "owner",
  },
];

const CUSTOMER_SEED: ReadonlyArray<SampleCustomer> = [
  {
    name: "Acme Corp",
    email: "ap@acme.example",
    default_rate: 150,
    notes: "Primary platform account. Billed monthly net-30.",
    rate_visibility: "admins",
    rate_editability: "admins",
  },
  {
    name: "Globex Corporation",
    email: "billing@globex.example",
    default_rate: 175,
    notes: "Quarterly retainer + overage.",
    rate_visibility: "all_members",
    rate_editability: "owner",
  },
  {
    name: "Initech",
    email: "ap@initech.example",
    default_rate: 125,
    notes: null,
    rate_visibility: "owner",
    rate_editability: "owner",
  },
  {
    name: "Hooli",
    email: "accounts@hooli.example",
    default_rate: 200,
    notes: "Prefers invoices on the 1st.",
    rate_visibility: "admins",
    rate_editability: "admins",
  },
];

// Stable category set names we reference throughout.
const BASE_SET_NAME = "Standard Work Types";
const PLATFORM_EXTENSION_NAME = "Platform Migration categories";

const PROJECT_SEED: ReadonlyArray<SampleProject> = [
  {
    customerIndex: 0,
    name: "Platform Migration",
    description: "Lift core services off legacy infra onto the new stack.",
    hourly_rate: 150,
    github_repo: "acmecorp/platform",
    status: "active",
    rate_visibility: "admins",
    rate_editability: "owner",
    time_entries_visibility: "read_write_all",
    baseCategorySet: BASE_SET_NAME,
    require_timestamps: false,
  },
  {
    customerIndex: 0,
    name: "Q2 Feature Work",
    description: null,
    hourly_rate: 150,
    github_repo: null,
    status: "active",
    rate_visibility: "admins",
    rate_editability: "admins",
    time_entries_visibility: null,
    baseCategorySet: BASE_SET_NAME,
    require_timestamps: false,
  },
  {
    customerIndex: 1,
    name: "Data Pipeline",
    description: "Event-stream ingestion pipeline, Kafka → warehouse.",
    hourly_rate: 175,
    github_repo: "globex/pipeline",
    status: "active",
    rate_visibility: "all_members",
    rate_editability: "owner",
    time_entries_visibility: null,
    baseCategorySet: null,
    require_timestamps: false,
  },
  {
    customerIndex: 2,
    name: "TPS Reports Overhaul",
    description: "Replace the legacy TPS system end-to-end.",
    hourly_rate: 125,
    github_repo: null,
    status: "active",
    rate_visibility: "owner",
    rate_editability: "owner",
    time_entries_visibility: null,
    baseCategorySet: BASE_SET_NAME,
    require_timestamps: false,
  },
  {
    // The one timestamp-required project. Nucleus bills by calendar
    // block, so start/end precision matters here — keeps that code
    // path exercised in sample data without polluting the majority
    // case, which is "date + duration only".
    customerIndex: 3,
    name: "Nucleus Backend",
    description: "API and service layer for the Nucleus product.",
    hourly_rate: 200,
    github_repo: "hooli/nucleus",
    status: "active",
    rate_visibility: "admins",
    rate_editability: "admins",
    time_entries_visibility: null,
    baseCategorySet: BASE_SET_NAME,
    require_timestamps: true,
  },
  {
    customerIndex: null,
    name: "Internal R&D",
    description: "Non-billable exploration and tooling.",
    hourly_rate: null,
    github_repo: null,
    status: "active",
    rate_visibility: "owner",
    rate_editability: "owner",
    time_entries_visibility: null,
    baseCategorySet: null,
    require_timestamps: false,
  },
];

const CATEGORY_SETS_SEED: ReadonlyArray<SampleCategorySet> = [
  {
    name: BASE_SET_NAME,
    scope: "team",
    extendsProjectName: null,
    description: "Cross-project work types.",
  },
  {
    name: PLATFORM_EXTENSION_NAME,
    scope: "project",
    extendsProjectName: "Platform Migration",
    description: "Migration-specific categories layered on top of the base.",
  },
];

const CATEGORIES_SEED: ReadonlyArray<SampleCategory> = [
  { setName: BASE_SET_NAME, name: "Development", color: "#2563eb", sort_order: 10 },
  { setName: BASE_SET_NAME, name: "Review", color: "#a855f7", sort_order: 20 },
  { setName: BASE_SET_NAME, name: "Testing", color: "#059669", sort_order: 30 },
  { setName: BASE_SET_NAME, name: "Meetings", color: "#d97706", sort_order: 40 },
  { setName: BASE_SET_NAME, name: "Ops", color: "#dc2626", sort_order: 50 },
  {
    setName: PLATFORM_EXTENSION_NAME,
    name: "Kubernetes migration",
    color: "#0891b2",
    sort_order: 10,
  },
  {
    setName: PLATFORM_EXTENSION_NAME,
    name: "Database migration",
    color: "#9333ea",
    sort_order: 20,
  },
];

const DESCRIPTIONS: readonly string[] = [
  "Debugging auth middleware issue",
  "Pairing with ops on deploy pipeline",
  "Code review + feedback on PRs",
  "Spec work for upcoming feature",
  "Investigating performance regression",
  "Onboarding call + scoping",
  "Refactor data layer",
  "Migration planning",
  "Weekly sync",
  "Writing tests + cleanup",
  "Integrate new API endpoint",
  "Docs + walkthrough",
  "Bug triage",
  "Incident response",
  "Sprint planning",
];

const WEEKS = 12;
const ENTRIES_PER_WEEK_MIN = 18;
const ENTRIES_PER_WEEK_MAX = 32;
const CATEGORIZATION_RATE = 0.6;

const INVOICE_SEED: ReadonlyArray<SampleInvoice> = [
  {
    customerIndex: 0,
    status: "sent",
    windowDays: { from: 60, to: 30 },
    notes: "Thanks — please remit by due date.",
    invoice_number_suffix: "S01",
    due_days: 30,
  },
  {
    customerIndex: 1,
    status: "draft",
    windowDays: { from: 14, to: 0 },
    notes: null,
    invoice_number_suffix: "D01",
    due_days: 30,
  },
];

// ────────────────────────────────────────────────────────────────
// Entry helpers
// ────────────────────────────────────────────────────────────────

interface BuildEntriesOpts {
  rng: () => number;
  now: Date;
  projects: readonly SampleProject[];
  teamMembers: readonly SampleTeamMember[];
}

function categoryForProject(
  rng: () => number,
  project: SampleProject,
): { setName: string; categoryName: string } | null {
  if (project.baseCategorySet === null) return null;
  if (rng() > CATEGORIZATION_RATE) return null;

  const isPlatform = project.name === "Platform Migration";
  const useExtension = isPlatform && rng() < 0.25;

  if (useExtension) {
    const name =
      rng() < 0.5 ? "Kubernetes migration" : "Database migration";
    return { setName: PLATFORM_EXTENSION_NAME, categoryName: name };
  }

  const name = pick(rng, [
    "Development",
    "Review",
    "Testing",
    "Meetings",
    "Ops",
  ]);
  return { setName: project.baseCategorySet, categoryName: name };
}

function buildEntries(opts: BuildEntriesOpts): SampleEntry[] {
  const { rng, now, projects, teamMembers } = opts;
  const entries: SampleEntry[] = [];

  const mondayOfThisWeek = new Date(now);
  const dow = mondayOfThisWeek.getDay();
  const daysSinceMonday = (dow + 6) % 7;
  mondayOfThisWeek.setDate(mondayOfThisWeek.getDate() - daysSinceMonday);
  mondayOfThisWeek.setHours(0, 0, 0, 0);

  const authorChoices: Array<readonly [number | null, number]> = [
    [null, 4],
  ];
  teamMembers.forEach((_, i) => {
    authorChoices.push([i, 2]);
  });

  // Base day-weights Mon..Sun. Clamped per-week to only the days that
  // have already elapsed, so current-week entries never land on a
  // future day and dense morning loads still put work on "today".
  const BASE_DAY_WEIGHTS: ReadonlyArray<readonly [number, number]> = [
    [0, 5],
    [1, 5],
    [2, 5],
    [3, 5],
    [4, 4],
    [5, 1],
    [6, 1],
  ];

  for (let w = 0; w < WEEKS; w++) {
    const weekStart = new Date(mondayOfThisWeek);
    weekStart.setDate(weekStart.getDate() - w * 7);

    // For the current week, only generate entries on Monday..today; for
    // earlier weeks the full Mon..Sun window is valid.
    const lastAllowedDayOffset = w === 0 ? daysSinceMonday : 6;
    const dayWeights = BASE_DAY_WEIGHTS.slice(0, lastAllowedDayOffset + 1);
    if (dayWeights.length === 0) continue;

    const rawWeekCount =
      ENTRIES_PER_WEEK_MIN +
      Math.floor(rng() * (ENTRIES_PER_WEEK_MAX - ENTRIES_PER_WEEK_MIN + 1));
    // Scale by fraction of the week that's actually elapsed for w=0,
    // otherwise Monday-morning loads would dump 18–32 entries onto
    // today (the only allowed day) and swamp the grid.
    const weekCount =
      w === 0
        ? Math.max(3, Math.round(rawWeekCount * ((daysSinceMonday + 1) / 7)))
        : rawWeekCount;

    for (let i = 0; i < weekCount; i++) {
      const dayOffset = pickWeighted<number>(rng, dayWeights);
      const day = new Date(weekStart);
      day.setDate(day.getDate() + dayOffset);
      if (day.getTime() > now.getTime()) continue;

      const hour = pickWeighted<number>(rng, [
        [8, 2],
        [9, 5],
        [10, 6],
        [11, 5],
        [12, 2],
        [13, 5],
        [14, 6],
        [15, 5],
        [16, 3],
        [17, 2],
      ]);
      const minute = Math.floor(rng() * 4) * 15;
      const start = new Date(day);
      start.setHours(hour, minute, 0, 0);

      const durationMinutes = pickWeighted<number>(rng, [
        [15, 2],
        [30, 4],
        [45, 4],
        [60, 6],
        [90, 6],
        [120, 5],
        [150, 3],
        [180, 2],
        [240, 1],
      ]);
      let end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      // If this entry would still be running, clip its end to a few
      // minutes before `now` instead of dropping it outright. Keeps
      // morning "today" entries on the grid even when the naïve end
      // time lands in the future.
      if (end.getTime() > now.getTime()) {
        const clippedEndMs = now.getTime() - 5 * 60 * 1000;
        if (clippedEndMs - start.getTime() < 15 * 60 * 1000) continue;
        end = new Date(clippedEndMs);
      }

      const projectIndex = Math.floor(rng() * projects.length);
      const project = projects[projectIndex]!;
      const hasDescription = rng() < 0.75;
      const billable = rng() < 0.85 && project.hourly_rate !== null;
      const hasGithub = project.github_repo !== null && rng() < 0.25;
      const memberIndex = pickWeighted<number | null>(rng, authorChoices);

      entries.push({
        projectIndex,
        memberIndex,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        description: hasDescription ? pick(rng, DESCRIPTIONS) : null,
        billable,
        github_issue: hasGithub ? 100 + Math.floor(rng() * 800) : null,
        categoryRef: categoryForProject(rng, project),
      });
    }
  }

  entries.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return entries;
}

// ────────────────────────────────────────────────────────────────
// Main generator
// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// Business identity + registrations seeds
// ────────────────────────────────────────────────────────────────
//
// A Delaware-formed LLC with foreign qualifications in CA and TX. Uses
// CSC as the Delaware registered agent — a realistic setup for a small
// consulting business operating across state lines.

const BUSINESS_IDENTITY_SEED: SampleBusinessIdentity = {
  display_name: "Acme Consulting",
  legal_name: "Acme Consulting Partners LLC",
  entity_type: "llc",
  tax_id: "85-1234567",
  date_incorporated: "2023-06-15",
  fiscal_year_start: "01-01",
};

const REGISTERED_AGENTS_SEED: SampleRegisteredAgent[] = [
  {
    key: "csc-de",
    name: "Corporation Service Company",
    address_line1: "251 Little Falls Drive",
    address_line2: null,
    city: "Wilmington",
    state: "DE",
    postal_code: "19808",
    country: "US",
    contact_email: null,
    contact_phone: "+1-302-636-5400",
    notes: "Delaware formation agent. Serves filings in all states.",
  },
];

const STATE_REGISTRATIONS_SEED: SampleStateRegistration[] = [
  {
    state: "DE",
    is_formation: true,
    registration_type: "domestic",
    entity_number: "7654321",
    state_tax_id: null,
    registered_on: "2023-06-15",
    nexus_start_date: "2023-06-15",
    registration_status: "active",
    report_frequency: "annual",
    due_rule: "fixed_date",
    annual_report_due_mmdd: "06-01",
    annual_report_fee_cents: 30000,
    agentKey: "csc-de",
    notes: "Formation state. DE LLC franchise tax due June 1 annually.",
  },
  {
    state: "CA",
    is_formation: false,
    registration_type: "foreign_qualification",
    entity_number: "202400112233",
    state_tax_id: "CA-TIN-9988776",
    registered_on: "2024-02-10",
    nexus_start_date: "2024-01-01",
    registration_status: "active",
    report_frequency: "biennial",
    due_rule: "anniversary",
    annual_report_due_mmdd: null,
    annual_report_fee_cents: 2000,
    agentKey: null,
    notes: "Statement of Information filed every 2 years at anniversary.",
  },
  {
    state: "TX",
    is_formation: false,
    registration_type: "foreign_qualification",
    entity_number: "0804433221",
    state_tax_id: null,
    registered_on: "2024-09-01",
    nexus_start_date: "2024-08-15",
    registration_status: "pending",
    report_frequency: "annual",
    due_rule: "fixed_date",
    annual_report_due_mmdd: "05-15",
    annual_report_fee_cents: null,
    agentKey: null,
    notes: "Franchise tax report due May 15.",
  },
];

export function generateSampleData(opts: {
  now: Date;
  seed?: number;
}): SampleData {
  const seed = opts.seed ?? 0x5eed;
  const rng = makeRng(seed);
  const now = opts.now;

  const teamSettings = { ...TEAM_SETTINGS_SEED };
  const businessIdentity = { ...BUSINESS_IDENTITY_SEED };
  const registeredAgents = REGISTERED_AGENTS_SEED.map((a) => ({ ...a }));
  const stateRegistrations = STATE_REGISTRATIONS_SEED.map((r) => ({ ...r }));
  const teamMembers = TEAM_MEMBER_SEED.map((m) => ({ ...m }));
  const customers = CUSTOMER_SEED.map((c) => ({ ...c }));
  const projects = PROJECT_SEED.map((p) => ({ ...p }));
  const categorySets = CATEGORY_SETS_SEED.map((s) => ({ ...s }));
  const categories = CATEGORIES_SEED.map((c) => ({ ...c }));

  const entries = buildEntries({ rng, now, projects, teamMembers });
  const invoices = INVOICE_SEED.map((i) => ({ ...i }));
  const expenses = generateExpenses(rng, now, projects);

  return {
    teamSettings,
    businessIdentity,
    registeredAgents,
    stateRegistrations,
    teamMembers,
    customers,
    projects,
    categorySets,
    categories,
    entries,
    invoices,
    expenses,
  };
}

// ────────────────────────────────────────────────────────────────
// Expenses (unchanged shape from prior implementation)
// ────────────────────────────────────────────────────────────────

interface ExpenseTemplate {
  readonly vendor: string | null;
  readonly category: SampleExpense["category"];
  readonly amountRange: readonly [number, number];
  readonly description: string | null;
  readonly weight: number;
  readonly billableBias: number;
}

const EXPENSE_TEMPLATES: readonly ExpenseTemplate[] = [
  { vendor: "GitHub", category: "subscriptions", amountRange: [21, 21], description: "Team plan", weight: 3, billableBias: 0 },
  { vendor: "Vercel", category: "subscriptions", amountRange: [20, 60], description: "Pro hosting", weight: 3, billableBias: 0 },
  { vendor: "Supabase", category: "subscriptions", amountRange: [25, 120], description: "Database + auth", weight: 3, billableBias: 0 },
  { vendor: "Linear", category: "subscriptions", amountRange: [8, 16], description: "Project tracking", weight: 2, billableBias: 0 },
  { vendor: "OpenAI", category: "software", amountRange: [20, 200], description: "API usage", weight: 4, billableBias: 0.4 },
  { vendor: "Anthropic", category: "software", amountRange: [20, 200], description: "API usage", weight: 4, billableBias: 0.4 },
  { vendor: "AWS", category: "software", amountRange: [40, 320], description: "Cloud infra", weight: 5, billableBias: 0.6 },
  { vendor: "Figma", category: "software", amountRange: [12, 24], description: "Design tool", weight: 2, billableBias: 0 },
  { vendor: "Chipotle", category: "meals", amountRange: [12, 24], description: "Working lunch", weight: 3, billableBias: 0 },
  { vendor: "Blue Bottle", category: "meals", amountRange: [5, 14], description: "Coffee + pastry", weight: 4, billableBias: 0 },
  { vendor: "Uber", category: "travel", amountRange: [12, 48], description: "Client meeting", weight: 2, billableBias: 0.5 },
  { vendor: "United Airlines", category: "travel", amountRange: [250, 780], description: "Onsite trip", weight: 1, billableBias: 0.8 },
  { vendor: "Marriott", category: "travel", amountRange: [180, 420], description: "Hotel", weight: 1, billableBias: 0.8 },
  { vendor: "Apple", category: "hardware", amountRange: [80, 1800], description: "Equipment", weight: 1, billableBias: 0 },
  { vendor: "Amazon", category: "office", amountRange: [18, 160], description: "Supplies", weight: 3, billableBias: 0 },
  { vendor: "Bench", category: "professional_services", amountRange: [180, 260], description: "Bookkeeping", weight: 2, billableBias: 0 },
  { vendor: "LegalZoom", category: "professional_services", amountRange: [40, 220], description: "Filing", weight: 1, billableBias: 0 },
  { vendor: null, category: "fees", amountRange: [1, 35], description: "Bank / processing fees", weight: 2, billableBias: 0 },
  { vendor: null, category: "other", amountRange: [8, 60], description: null, weight: 1, billableBias: 0 },
];

const EXPENSES_PER_MONTH_MIN = 6;
const EXPENSES_PER_MONTH_MAX = 16;

function generateExpenses(
  rng: () => number,
  now: Date,
  projects: readonly SampleProject[],
): SampleExpense[] {
  const expenses: SampleExpense[] = [];
  const billableProjects = projects
    .map((p, i) => ({ p, i }))
    .filter((x) => x.p.hourly_rate !== null);

  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let m = 0; m < 12; m++) {
    const monthStart = new Date(thisMonth);
    monthStart.setMonth(monthStart.getMonth() - m);
    const daysInMonth = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0,
    ).getDate();

    const count =
      EXPENSES_PER_MONTH_MIN +
      Math.floor(rng() * (EXPENSES_PER_MONTH_MAX - EXPENSES_PER_MONTH_MIN + 1));

    for (let i = 0; i < count; i++) {
      const tpl = pickWeighted<ExpenseTemplate>(
        rng,
        EXPENSE_TEMPLATES.map((t) => [t, t.weight] as const),
      );
      const day = 1 + Math.floor(rng() * daysInMonth);
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      if (date.getTime() > now.getTime()) continue;

      const [lo, hi] = tpl.amountRange;
      const amount = Math.round((lo + rng() * (hi - lo)) * 100) / 100;

      const billable = tpl.billableBias > 0 && rng() < tpl.billableBias;
      const projectIndex =
        billable && billableProjects.length > 0
          ? billableProjects[Math.floor(rng() * billableProjects.length)]!.i
          : null;

      expenses.push({
        incurredOn: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        amount,
        currency: "USD",
        vendor: tpl.vendor,
        category: tpl.category,
        description: tpl.description,
        projectIndex,
        billable,
      });
    }
  }

  expenses.sort((a, b) => a.incurredOn.localeCompare(b.incurredOn));
  return expenses;
}
