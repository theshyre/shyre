/**
 * Deterministic sample-data generator for the /admin/sample-data tool.
 *
 * Produces a realistic-looking but fabricated spread of customers, projects,
 * and time entries. The same seed + now always produces the same output so
 * repeat loads feel familiar.
 */

export interface SampleCustomer {
  name: string;
  email: string | null;
  default_rate: number | null;
  notes: string | null;
}

export interface SampleProject {
  /** Index into SampleData.customers, or null for an internal project. */
  customerIndex: number | null;
  name: string;
  description: string | null;
  hourly_rate: number | null;
  github_repo: string | null;
  status: "active" | "paused" | "completed";
}

export interface SampleEntry {
  /** Index into SampleData.projects. */
  projectIndex: number;
  /** ISO timestamp. */
  startIso: string;
  /** ISO timestamp. */
  endIso: string;
  description: string | null;
  billable: boolean;
  github_issue: number | null;
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

export interface SampleData {
  customers: SampleCustomer[];
  projects: SampleProject[];
  entries: SampleEntry[];
  expenses: SampleExpense[];
}

/** mulberry32 — small, deterministic PRNG. */
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
  // arr is non-empty at every call site; non-null assert ok inside this helper
  const idx = Math.floor(rng() * arr.length);
  return arr[idx] as T;
}

function pickWeighted<T>(rng: () => number, choices: ReadonlyArray<readonly [T, number]>): T {
  const total = choices.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, weight] of choices) {
    r -= weight;
    if (r <= 0) return value;
  }
  return choices[choices.length - 1]![0];
}

const CUSTOMER_SEED: ReadonlyArray<Omit<SampleCustomer, "notes"> & { notes: string | null }> = [
  {
    name: "Acme Corp",
    email: "ap@acme.example",
    default_rate: 150,
    notes: "Primary platform account. Billed monthly net-30.",
  },
  {
    name: "Globex Corporation",
    email: "billing@globex.example",
    default_rate: 175,
    notes: "Quarterly retainer + overage.",
  },
  {
    name: "Initech",
    email: "ap@initech.example",
    default_rate: 125,
    notes: null,
  },
  {
    name: "Hooli",
    email: "accounts@hooli.example",
    default_rate: 200,
    notes: "Prefers invoices on the 1st.",
  },
];

const PROJECT_SEED: ReadonlyArray<SampleProject> = [
  {
    customerIndex: 0,
    name: "Platform Migration",
    description: "Lift core services off legacy infra onto the new stack.",
    hourly_rate: 150,
    github_repo: "acmecorp/platform",
    status: "active",
  },
  {
    customerIndex: 0,
    name: "Q2 Feature Work",
    description: null,
    hourly_rate: 150,
    github_repo: null,
    status: "active",
  },
  {
    customerIndex: 1,
    name: "Data Pipeline",
    description: "Event-stream ingestion pipeline, Kafka → warehouse.",
    hourly_rate: 175,
    github_repo: "globex/pipeline",
    status: "active",
  },
  {
    customerIndex: 2,
    name: "TPS Reports Overhaul",
    description: "Replace the legacy TPS system end-to-end.",
    hourly_rate: 125,
    github_repo: null,
    status: "active",
  },
  {
    customerIndex: 3,
    name: "Nucleus Backend",
    description: "API and service layer for the Nucleus product.",
    hourly_rate: 200,
    github_repo: "hooli/nucleus",
    status: "active",
  },
  {
    customerIndex: null,
    name: "Internal R&D",
    description: "Non-billable exploration and tooling.",
    hourly_rate: null,
    github_repo: null,
    status: "active",
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

/**
 * Generate the sample payload. Deterministic for a given (now, seed) pair.
 */
export function generateSampleData(opts: { now: Date; seed?: number }): SampleData {
  const seed = opts.seed ?? 0x5eed;
  const rng = makeRng(seed);
  const now = opts.now;

  const customers: SampleCustomer[] = CUSTOMER_SEED.map((c) => ({ ...c }));
  const projects: SampleProject[] = PROJECT_SEED.map((p) => ({ ...p }));

  const entries: SampleEntry[] = [];

  // Work backwards WEEKS weeks, generating entries per week.
  // Day 0 of the loop = the Monday of the current local week, so entries
  // land on realistic weekdays.
  const mondayOfThisWeek = new Date(now);
  const dow = mondayOfThisWeek.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  mondayOfThisWeek.setDate(mondayOfThisWeek.getDate() - daysSinceMonday);
  mondayOfThisWeek.setHours(0, 0, 0, 0);

  for (let w = 0; w < WEEKS; w++) {
    const weekStart = new Date(mondayOfThisWeek);
    weekStart.setDate(weekStart.getDate() - w * 7);

    const weekCount =
      ENTRIES_PER_WEEK_MIN +
      Math.floor(rng() * (ENTRIES_PER_WEEK_MAX - ENTRIES_PER_WEEK_MIN + 1));

    for (let i = 0; i < weekCount; i++) {
      // Day within week: Mon-Fri heavy (weights 5/5/5/5/4/1/1 for Mon..Sun)
      const dayOffset = pickWeighted<number>(rng, [
        [0, 5],
        [1, 5],
        [2, 5],
        [3, 5],
        [4, 4],
        [5, 1],
        [6, 1],
      ]);
      const day = new Date(weekStart);
      day.setDate(day.getDate() + dayOffset);

      // Skip any entry that would land in the future.
      if (day.getTime() > now.getTime()) continue;

      // Start hour: 8am–6pm weighted toward mid-morning / early afternoon.
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

      // Duration 15m – 4h, mean ~1.5h
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
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      if (end.getTime() > now.getTime()) continue;

      const projectIndex = Math.floor(rng() * projects.length);
      const hasDescription = rng() < 0.75;
      const billable = rng() < 0.85 && projects[projectIndex]!.hourly_rate !== null;
      const hasGithub = projects[projectIndex]!.github_repo !== null && rng() < 0.25;

      entries.push({
        projectIndex,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        description: hasDescription ? pick(rng, DESCRIPTIONS) : null,
        billable,
        github_issue: hasGithub ? 100 + Math.floor(rng() * 800) : null,
      });
    }
  }

  // Sort chronologically so inserts write in a predictable order.
  entries.sort((a, b) => a.startIso.localeCompare(b.startIso));

  const expenses = generateExpenses(rng, now, projects);

  return { customers, projects, entries, expenses };
}

interface ExpenseTemplate {
  readonly vendor: string | null;
  readonly category: SampleExpense["category"];
  readonly amountRange: readonly [number, number];
  readonly description: string | null;
  /** Relative likelihood weight. */
  readonly weight: number;
  /** Chance this expense lands on a billable project (0..1). */
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
  projects: SampleProject[],
): SampleExpense[] {
  const expenses: SampleExpense[] = [];
  // Project selection for billable expenses: prefer projects with a rate.
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
