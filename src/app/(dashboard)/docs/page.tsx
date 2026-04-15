import {
  BookOpen,
  Clock,
  Users,
  Briefcase,
  FileText,
  Shield,
  Receipt,
  Sparkles,
  Compass,
  ArrowRight,
  Building2,
} from "lucide-react";
import Link from "next/link";
import { getUserTeams } from "@/lib/team-context";
import { isSystemAdmin } from "@/lib/system-admin";

interface ModuleCard {
  name: string;
  blurb: string;
  icon: typeof Clock;
  primary: { title: string; href: string };
  more: Array<{ title: string; href: string }>;
}

const MODULES: ModuleCard[] = [
  {
    name: "Stint",
    blurb: "Time tracking. The daily-driver module.",
    icon: Clock,
    primary: { title: "Time tracking", href: "/docs/guides/features/time-tracking" },
    more: [
      { title: "Categories", href: "/docs/guides/features/categories" },
      { title: "Templates", href: "/docs/guides/features/templates" },
      { title: "Imports (Harvest)", href: "/docs/guides/features/imports" },
    ],
  },
  {
    name: "Customers",
    blurb: "The people and companies you bill. Shared across modules.",
    icon: Users,
    primary: { title: "Customers", href: "/docs/guides/features/customers" },
    more: [
      { title: "Projects", href: "/docs/guides/features/projects" },
      { title: "Customer sharing", href: "/docs/guides/agency/customer-sharing" },
    ],
  },
  {
    name: "Business",
    blurb: "Your company's legal identity, expenses, and (soon) people.",
    icon: Briefcase,
    primary: { title: "Business identity", href: "/docs/guides/features/business-identity" },
    more: [{ title: "Expenses", href: "/docs/guides/features/expenses" }],
  },
  {
    name: "Invoicing",
    blurb: "Bill your customers from tracked time and expenses.",
    icon: FileText,
    primary: { title: "Invoicing", href: "/docs/guides/features/invoicing" },
    more: [{ title: "Exports for bookkeeping", href: "/docs/guides/bookkeeper/exports" }],
  },
];

const REFERENCE = [
  { title: "Architecture", href: "/docs/reference/architecture" },
  { title: "Database schema", href: "/docs/reference/database-schema" },
  { title: "Modules", href: "/docs/reference/modules" },
  { title: "Security audit log", href: "/docs/security/SECURITY_AUDIT_LOG" },
];

interface PersonalLink {
  title: string;
  href: string;
  blurb: string;
}

function buildPersonalLinks(opts: {
  isOwnerOrAdminOfAnyOrg: boolean;
  isMemberOnly: boolean;
  isSysadmin: boolean;
}): PersonalLink[] {
  const links: PersonalLink[] = [
    {
      title: "Getting started",
      href: "/docs/guides/getting-started",
      blurb: "First login to first invoice — the orientation tour.",
    },
    {
      title: "Time tracking",
      href: "/docs/guides/features/time-tracking",
      blurb: "Start a timer, edit entries inline, navigate by week.",
    },
    {
      title: "Keyboard shortcuts",
      href: "/docs/guides/features/keyboard-shortcuts",
      blurb: "Every shortcut in the app, in one cheatsheet.",
    },
  ];

  if (opts.isOwnerOrAdminOfAnyOrg) {
    links.push(
      {
        title: "Teams and roles",
        href: "/docs/guides/agency/teams-and-roles",
        blurb: "Invite members, manage roles, transfer ownership.",
      },
      {
        title: "Customer sharing",
        href: "/docs/guides/agency/customer-sharing",
        blurb: "Share a customer record across teams without leaking the rest.",
      },
      {
        title: "Business identity",
        href: "/docs/guides/features/business-identity",
        blurb: "Legal name, EIN, fiscal year — used on invoices and reports.",
      },
    );
  }

  if (opts.isMemberOnly) {
    links.push({
      title: "Templates",
      href: "/docs/guides/features/templates",
      blurb: "One-click start for repeating work.",
    });
  }

  if (opts.isSysadmin) {
    links.push(
      {
        title: "System Admin: env configuration",
        href: "/docs/guides/admin/env-configuration",
        blurb: "Required env vars, where to set them, how to verify.",
      },
      {
        title: "System Admin: error log",
        href: "/docs/guides/admin/error-log",
        blurb: "Triage server-side errors, mark resolved, audit trail.",
      },
      {
        title: "System Admin: sample data tool",
        href: "/docs/guides/admin/sample-data",
        blurb: "Load / replay / clear fabricated data per org for testing.",
      },
    );
  }

  return links;
}

const ROLE_BROWSE = [
  {
    label: "Agency owners",
    icon: Users,
    href: "/docs/guides/agency",
    blurb: "Multi-user scenarios, sharing, security groups.",
  },
  {
    label: "Bookkeepers",
    icon: Receipt,
    href: "/docs/guides/bookkeeper",
    blurb: "Reconciliation, exports, period close.",
  },
  {
    label: "System admins",
    icon: Shield,
    href: "/docs/guides/admin",
    blurb: "Tools behind the System Admin sidebar section.",
  },
];

export default async function DocsIndexPage(): Promise<React.JSX.Element> {
  const [teams, sysadmin] = await Promise.all([getUserTeams(), isSystemAdmin()]);

  const isOwnerOrAdminOfAnyOrg = teams.some(
    (o) => o.role === "owner" || o.role === "admin",
  );
  const isMemberOnly = teams.length > 0 && !isOwnerOrAdminOfAnyOrg;

  const personalLinks = buildPersonalLinks({
    isOwnerOrAdminOfAnyOrg,
    isMemberOnly,
    isSysadmin: sysadmin,
  });

  const roleSummary = describeRoleMix(teams, sysadmin);

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <BookOpen size={24} className="text-accent" />
          <h1 className="text-2xl font-bold text-content">Documentation</h1>
        </div>
        <p className="max-w-3xl text-sm text-content-secondary leading-relaxed">
          <strong className="text-content">Shyre</strong> is a platform for running a consulting
          business. Time tracking, customers, invoicing, and business identity live under one roof.
          The platform is composed of <strong className="text-content">modules</strong> — Stint
          (time tracking) is the main one today; Business, Customers, and Invoicing fill out the
          rest. Use the modules below to find what you need, or jump to{" "}
          <Link
            href="/docs/guides/getting-started"
            className="text-accent hover:underline"
          >
            Getting started
          </Link>{" "}
          if this is your first time.
        </p>
      </header>

      {/* Modules */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Compass size={16} className="text-content-muted" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            Modules
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {MODULES.map((mod) => (
            <article
              key={mod.name}
              className="rounded-lg border border-edge bg-surface-raised p-5 space-y-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft">
                  <mod.icon size={18} className="text-accent" />
                </div>
                <h3 className="text-base font-semibold text-content">{mod.name}</h3>
              </div>
              <p className="text-sm text-content-secondary">{mod.blurb}</p>
              <Link
                href={mod.primary.href}
                className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                {mod.primary.title}
                <ArrowRight size={14} />
              </Link>
              {mod.more.length > 0 && (
                <ul className="pt-1 space-y-1">
                  {mod.more.map((m) => (
                    <li key={m.href}>
                      <Link
                        href={m.href}
                        className="text-xs text-content-muted hover:text-accent hover:underline"
                      >
                        · {m.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Role-aware: For you */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            For you
          </h2>
          {roleSummary && (
            <span className="text-xs text-content-muted">· {roleSummary}</span>
          )}
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          {personalLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="block rounded-md border border-edge bg-surface-raised p-3 hover:bg-hover transition-colors"
              >
                <div className="text-sm font-medium text-accent">{link.title}</div>
                <div className="mt-0.5 text-xs text-content-muted">{link.blurb}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Role-specific guide browse (secondary) */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Building2 size={16} className="text-content-muted" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            Role-specific guides
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {ROLE_BROWSE.map((row) => (
            <Link
              key={row.href}
              href={row.href}
              className="flex items-start gap-3 rounded-md border border-edge bg-surface-raised p-3 hover:bg-hover transition-colors"
            >
              <row.icon size={18} className="text-accent shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium text-content">{row.label}</div>
                <div className="mt-0.5 text-xs text-content-muted">{row.blurb}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Reference */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={16} className="text-content-muted" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            Reference
          </h2>
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          {REFERENCE.map((ref) => (
            <li key={ref.href}>
              <Link
                href={ref.href}
                className="block rounded-md border border-edge bg-surface-raised p-3 text-sm text-accent hover:bg-hover transition-colors"
              >
                {ref.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * Brief human-readable description of the user's role mix, shown as a
 * subtitle next to "For you" so the user sees *why* these particular
 * links were chosen.
 */
function describeRoleMix(
  teams: { role: "owner" | "admin" | "member" }[],
  isSysadmin: boolean,
): string {
  const labels: string[] = [];
  if (isSysadmin) labels.push("System admin");
  if (teams.some((o) => o.role === "owner")) labels.push("Owner");
  else if (teams.some((o) => o.role === "admin")) labels.push("Admin");
  else if (teams.length > 0) labels.push("Member");
  if (teams.length > 1) labels.push(`${teams.length} teams`);
  return labels.join(" · ");
}
