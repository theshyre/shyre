import {
  BarChart3,
  Briefcase,
  Clock,
  FileSignature,
  FileText,
  Plug,
  Users,
} from "lucide-react";

/**
 * Shared docs topic manifest — see docs/reference/documentation.md →
 * "Topic navigation & quick guides — MANDATORY".
 *
 * This is the SINGLE source of truth for how `/docs` articles are
 * grouped and ordered. The hub (`docs/page.tsx`), the topic-index
 * route (`docs/topics/[topic]/page.tsx`), and the article prev/next
 * footer (`docs/[...slug]/page.tsx`) all read from `DOC_TOPICS` —
 * never maintain a second list.
 *
 * Ordering within a topic's `articles` array IS the reading order
 * used for the topic index and for prev/next. Position 0 is always
 * the topic's Quick guide (`quick: true`).
 */

export interface DocArticle {
  /** App route, e.g. "/docs/guides/features/time-tracking". */
  href: string;
  title: string;
  /** One-line summary shown on the topic-index page and hub card. */
  blurb: string;
  /**
   * Marks the topic's Quick guide — a short, task-first "get
   * started" article. Exactly one per topic, always at index 0.
   */
  quick?: boolean;
}

export interface DocTopic {
  /** URL slug — routes to /docs/topics/<slug>. */
  slug: string;
  name: string;
  blurb: string;
  icon: typeof Clock;
  /** Ordered; index 0 is the Quick guide. */
  articles: DocArticle[];
}

export const DOC_TOPICS: DocTopic[] = [
  {
    slug: "stint",
    name: "Stint",
    blurb: "Time tracking. The daily-driver module.",
    icon: Clock,
    articles: [
      {
        href: "/docs/guides/features/stint-quickstart",
        title: "Quick guide",
        blurb: "Start a timer and log your first day of time, in five steps.",
        quick: true,
      },
      {
        href: "/docs/guides/features/time-tracking",
        title: "Time tracking",
        blurb: "The daily-driver view — start a timer, edit entries inline, navigate by week.",
      },
      {
        href: "/docs/guides/features/categories",
        title: "Categories",
        blurb: "Tag time entries with what you were doing, separate from which project.",
      },
      {
        href: "/docs/guides/features/templates",
        title: "Templates",
        blurb: "One-click start for repeating work.",
      },
      {
        href: "/docs/guides/features/live-updates",
        title: "Live updates & day rollover",
        blurb: "Keeps the current date and teammates' background changes fresh without a refresh.",
      },
      {
        href: "/docs/guides/features/ticket-linking",
        title: "Ticket linking (Jira + GitHub)",
        blurb: "Type a ticket key into a description and Shyre fetches its title automatically.",
      },
      {
        href: "/docs/guides/features/sub-project-rollup-filter",
        title: "Sub-project rollup filter",
        blurb: "Scope Time and Reports to a project and roll up every phase beneath it.",
      },
      {
        href: "/docs/guides/features/imports",
        title: "Imports (Harvest)",
        blurb: "Bulk-import historical time data from Harvest.",
      },
    ],
  },
  {
    slug: "integrations",
    name: "Integrations",
    blurb: "Let Claude and other apps track time for you.",
    icon: Plug,
    articles: [
      {
        href: "/docs/guides/features/integrations-quickstart",
        title: "Quick guide",
        blurb: "Mint a token and let Claude Code track time for you, in five steps.",
        quick: true,
      },
      {
        href: "/docs/guides/features/tracking-time-day-to-day",
        title: "Day-to-day: what to tell Claude",
        blurb: "The daily loop and the exact prompts — log now, target a project, check totals, fix an entry.",
      },
      {
        href: "/docs/guides/features/integration-tokens",
        title: "Setup: tokens & the team switch",
        blurb: "Manage the personal access tokens that let external tools act on your behalf.",
      },
      {
        href: "/docs/guides/features/integrations-api",
        title: "API reference (REST + MCP)",
        blurb: "REST and MCP endpoints for reading project context and logging time.",
      },
      {
        href: "/docs/guides/features/claude-code-hooks-kit",
        title: "Claude Code hooks kit",
        blurb: "Deterministic time tracking via Claude Code session-lifecycle hooks.",
      },
      {
        href: "/docs/guides/features/claude-self-logging",
        title: "Let Claude log its own time",
        blurb: "The intent layer: Claude writes categorized, invoice-ready entries — plus routing a repo with multiple projects.",
      },
      {
        href: "/docs/guides/features/agent-attribution",
        title: "Agent attribution",
        blurb: "How Shyre records and displays which agent started a time entry.",
      },
      {
        href: "/docs/guides/features/agent-time-review",
        title: "Reviewing agent time on invoices",
        blurb: "Agent-tracked time flows straight into invoicing — no separate approval queue.",
      },
    ],
  },
  {
    slug: "customers",
    name: "Customers",
    blurb: "The people and companies you bill. Shared across modules.",
    icon: Users,
    articles: [
      {
        href: "/docs/guides/features/customers-quickstart",
        title: "Quick guide",
        blurb: "Add your first customer and project, in five steps.",
        quick: true,
      },
      {
        href: "/docs/guides/features/customers",
        title: "Customers",
        blurb: "The people and companies you bill, shared across every module.",
      },
      {
        href: "/docs/guides/features/customer-lifecycle",
        title: "Customer lifecycle (Active / Inactive / Archived)",
        blurb: "Three states control visibility and whether new work can be logged.",
      },
      {
        href: "/docs/guides/features/projects",
        title: "Projects",
        blurb: "Work you track time against, optionally scoped to a customer.",
      },
      {
        href: "/docs/guides/features/internal-projects",
        title: "Internal projects",
        blurb: "Track your own unbillable work — R&D, ops, internal tooling — the same way.",
      },
      {
        href: "/docs/guides/agency/customer-sharing",
        title: "Customer sharing",
        blurb: "Share one customer record across teams without leaking the rest.",
      },
    ],
  },
  {
    slug: "business",
    name: "Business",
    blurb: "Your company's legal identity, people, and expenses.",
    icon: Briefcase,
    articles: [
      {
        href: "/docs/guides/features/business-quickstart",
        title: "Quick guide",
        blurb: "Set your legal identity and log your first expense, in five steps.",
        quick: true,
      },
      {
        href: "/docs/guides/features/business-financials",
        title: "Financials",
        blurb: "Cash and profit-and-loss at a glance — collected, outstanding, unbilled, revenue, expenses, and net.",
      },
      {
        href: "/docs/guides/features/business-identity",
        title: "Business identity",
        blurb: "Legal name, EIN, and fiscal year — used on invoices and tax forms.",
      },
      {
        href: "/docs/guides/features/business-people",
        title: "People",
        blurb: "Everyone the business employs, contracts, or pays, in one list.",
      },
      {
        href: "/docs/guides/features/state-registrations",
        title: "State registrations",
        blurb: "Every state the business is formed or foreign-qualified in.",
      },
      {
        href: "/docs/guides/features/expenses",
        title: "Expenses",
        blurb: "Subscriptions, hardware, travel, and fees, with optional billable links to projects.",
      },
      {
        href: "/docs/guides/features/expense-categories",
        title: "Expense categories",
        blurb: "Which category fits which kind of expense, with examples.",
      },
      {
        href: "/docs/guides/features/expense-csv-import",
        title: "Expense CSV import",
        blurb: "Bulk-import historical expenses from a CSV, one year at a time.",
      },
    ],
  },
  {
    slug: "invoicing",
    name: "Invoicing",
    blurb: "Bill your customers from tracked time and expenses.",
    icon: FileText,
    articles: [
      {
        href: "/docs/guides/features/invoicing-quickstart",
        title: "Quick guide",
        blurb: "Turn tracked time into your first invoice, in five steps.",
        quick: true,
      },
      {
        href: "/docs/guides/features/invoicing",
        title: "Invoicing",
        blurb: "Generate and send invoices from tracked time; record payments as they land.",
      },
      {
        href: "/docs/guides/features/period-locks",
        title: "Period locks",
        blurb: "Lock a closed accounting period so past entries can't be edited.",
      },
      {
        href: "/docs/guides/bookkeeper/exports",
        title: "Exports for bookkeeping",
        blurb: "CSV exports for every entity that matters for reconciliation.",
      },
    ],
  },
  {
    slug: "proposals",
    name: "Proposals",
    blurb: "Quote fixed-price work, get it signed, convert it into billable projects.",
    icon: FileSignature,
    articles: [
      {
        href: "/docs/guides/features/proposals-quickstart",
        title: "Quick guide",
        blurb: "Draft a fixed-price quote and send it for sign-off, in five steps.",
        quick: true,
      },
      {
        href: "/docs/guides/features/proposals",
        title: "Proposals",
        blurb: "Quote fixed-price work, get it signed, and convert it into billable projects.",
      },
    ],
  },
  {
    slug: "reports",
    name: "Reports",
    blurb:
      "Hours, billability, estimated revenue, and collected cash — sliceable by period, project, and source.",
    icon: BarChart3,
    articles: [
      {
        href: "/docs/guides/features/reports-quickstart",
        title: "Quick guide",
        blurb: "Pull your first hours-and-revenue report, in five steps.",
        quick: true,
      },
      {
        href: "/docs/guides/features/reports",
        title: "Reports",
        blurb: "Hours, billability, estimated revenue, and collected cash, sliced by period and project.",
      },
    ],
  },
];

export function getTopicBySlug(slug: string): DocTopic | undefined {
  return DOC_TOPICS.find((topic) => topic.slug === slug);
}

export interface DocArticleContext {
  topic: DocTopic;
  article: DocArticle;
  index: number;
  prev: DocArticle | null;
  next: DocArticle | null;
}

/**
 * Look up a doc article by its href and resolve its topic + neighbors
 * in manifest order. Returns null for hrefs not in any topic (those
 * pages render no prev/next — see documentation.md rule 3).
 */
export function findArticleContext(href: string): DocArticleContext | null {
  for (const topic of DOC_TOPICS) {
    const index = topic.articles.findIndex((a) => a.href === href);
    if (index === -1) continue;
    const article = topic.articles[index];
    if (!article) return null;
    const prev = index > 0 ? (topic.articles[index - 1] ?? null) : null;
    const next =
      index < topic.articles.length - 1 ? (topic.articles[index + 1] ?? null) : null;
    return { topic, article, index, prev, next };
  }
  return null;
}
