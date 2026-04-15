import { BookOpen, User, Users, Receipt, Shield } from "lucide-react";
import Link from "next/link";

interface GuideCard {
  audience: string;
  icon: typeof BookOpen;
  blurb: string;
  slug: string;
  entries: Array<{ title: string; slug: string }>;
}

const GUIDE_CARDS: GuideCard[] = [
  {
    audience: "Solo consultant",
    icon: User,
    blurb: "The daily workflow — time, customers, projects, expenses, invoicing.",
    slug: "guides/solo",
    entries: [
      { title: "Time tracking", slug: "guides/solo/time-tracking" },
      { title: "Customers", slug: "guides/solo/customers" },
      { title: "Projects", slug: "guides/solo/projects" },
      { title: "Categories", slug: "guides/solo/categories" },
      { title: "Templates", slug: "guides/solo/templates" },
      { title: "Business identity", slug: "guides/solo/business-identity" },
      { title: "Expenses", slug: "guides/solo/expenses" },
      { title: "Invoicing", slug: "guides/solo/invoicing" },
      { title: "Imports (Harvest)", slug: "guides/solo/imports" },
      { title: "Keyboard shortcuts", slug: "guides/solo/keyboard-shortcuts" },
    ],
  },
  {
    audience: "Agency owner",
    icon: Users,
    blurb: "Multi-user setups — orgs, roles, shared customers, security groups.",
    slug: "guides/agency",
    entries: [
      { title: "Organizations and roles", slug: "guides/agency/orgs-and-roles" },
      { title: "Customer sharing", slug: "guides/agency/customer-sharing" },
      { title: "Security groups", slug: "guides/agency/security-groups" },
    ],
  },
  {
    audience: "Bookkeeper",
    icon: Receipt,
    blurb: "Exports, reconciliation, month-end, tax prep.",
    slug: "guides/bookkeeper",
    entries: [
      { title: "Exports", slug: "guides/bookkeeper/exports" },
      { title: "Period close", slug: "guides/bookkeeper/period-close" },
    ],
  },
  {
    audience: "System admin",
    icon: Shield,
    blurb: "Tools behind the System Admin sidebar section.",
    slug: "guides/admin",
    entries: [
      { title: "Env configuration", slug: "guides/admin/env-configuration" },
      { title: "Error log", slug: "guides/admin/error-log" },
      { title: "Users (all)", slug: "guides/admin/users" },
      { title: "All organizations", slug: "guides/admin/organizations" },
      { title: "Sample data tool", slug: "guides/admin/sample-data" },
    ],
  },
];

const REFERENCE = [
  { title: "Architecture", slug: "reference/architecture" },
  { title: "Database schema", slug: "reference/database-schema" },
  { title: "Modules", slug: "reference/modules" },
  { title: "Security audit log", slug: "security/SECURITY_AUDIT_LOG" },
];

export default async function DocsIndexPage(): Promise<React.JSX.Element> {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <BookOpen size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">Documentation</h1>
      </div>

      <p className="max-w-3xl text-sm text-content-secondary">
        Guides are organized by who you are. Reference docs cover the
        technical internals. Start with{" "}
        <Link href="/docs/guides/getting-started" className="text-accent hover:underline">
          Getting started
        </Link>{" "}
        if this is your first time.
      </p>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted mb-3">
          Guides
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {GUIDE_CARDS.map((card) => (
            <div
              key={card.slug}
              className="rounded-lg border border-edge bg-surface-raised p-5 space-y-3"
            >
              <div className="flex items-center gap-3">
                <card.icon size={20} className="text-accent" />
                <h3 className="text-base font-semibold text-content">
                  {card.audience}
                </h3>
              </div>
              <p className="text-sm text-content-secondary">{card.blurb}</p>
              <ul className="space-y-1 pt-1">
                {card.entries.map((entry) => (
                  <li key={entry.slug}>
                    <Link
                      href={`/docs/${entry.slug}`}
                      className="text-sm text-accent hover:underline"
                    >
                      {entry.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted mb-3">
          Reference
        </h2>
        <ul className="grid gap-2 md:grid-cols-2">
          {REFERENCE.map((ref) => (
            <li key={ref.slug}>
              <Link
                href={`/docs/${ref.slug}`}
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
