import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Settings,
  Building2,
  Shield,
  Tags,
  Bookmark,
  Upload,
  AlertTriangle,
  Users,
  Database,
  ShieldAlert,
  ListTree,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSystemAdmin } from "@/lib/system-admin";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import type { ComponentType } from "react";

interface Card {
  title: string;
  description: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  badge?: number;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.hub");
  return { title: t("title") };
}

export default async function AdminHubPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("admin.hub");
  const admin = await isSystemAdmin();

  const primary: Card[] = [
    // Business is reachable from the sidebar (Setup section, role-gated
    // to owner|admin of any business). Skipping the card here avoids
    // two paths to the same place; the sidebar entry is always visible
    // to viewers who can act on it.
    {
      title: t("cards.teams.title"),
      description: t("cards.teams.description"),
      href: "/teams",
      icon: Building2,
    },
    {
      title: t("cards.securityGroups.title"),
      description: t("cards.securityGroups.description"),
      href: "/security-groups",
      icon: Shield,
    },
    {
      title: t("cards.categories.title"),
      description: t("cards.categories.description"),
      href: "/categories",
      icon: Tags,
    },
    {
      title: t("cards.templates.title"),
      description: t("cards.templates.description"),
      href: "/templates",
      icon: Bookmark,
    },
    {
      title: t("cards.import.title"),
      description: t("cards.import.description"),
      href: "/import",
      icon: Upload,
    },
  ];

  // System admin section — only fetched + rendered for system admins.
  let systemCards: Card[] = [];
  if (admin) {
    const supabase = await createClient();
    const { count: unresolvedErrorCount } = await supabase
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null);

    systemCards = [
      {
        title: t("cards.errorLog.title"),
        description: t("cards.errorLog.description"),
        href: "/admin/errors",
        icon: AlertTriangle,
        badge: unresolvedErrorCount ?? 0,
      },
      {
        title: t("cards.users.title"),
        description: t("cards.users.description"),
        href: "/admin/users",
        icon: Users,
      },
      {
        title: t("cards.allTeams.title"),
        description: t("cards.allTeams.description"),
        href: "/admin/teams",
        // Different icon from the user-facing Teams card (Building2)
        // — the sysadmin variant is a read-only roster, not a team
        // manager. ListTree reads as "tree of all teams in the
        // instance" and breaks the visual collision.
        icon: ListTree,
      },
      {
        title: t("cards.sampleData.title"),
        description: t("cards.sampleData.description"),
        href: "/admin/sample-data",
        icon: Database,
      },
    ];
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
      </div>

      <p className="text-body text-content-secondary max-w-2xl">
        {t("description")}
      </p>

      <CardGrid cards={primary} />

      {admin && systemCards.length > 0 && (
        <section className="rounded-lg border border-warning/40 bg-warning-soft/20 p-5 space-y-4 mt-2">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-warning" />
            <h2 className="text-title font-semibold text-warning">
              {t("systemSection")}
            </h2>
          </div>
          <p className="text-caption text-content-muted max-w-3xl -mt-2">
            {t("systemSectionHint")}
          </p>
          <CardGrid cards={systemCards} />
        </section>
      )}
    </div>
  );
}

function CardGrid({ cards }: { cards: Card[] }): React.JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.href}
            href={card.href}
            className="group flex items-start gap-3 rounded-lg border border-edge bg-surface-raised p-4 transition-colors hover:border-accent/40 hover:bg-hover"
          >
            <Icon size={20} className="mt-0.5 text-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-body-lg font-semibold text-content">
                  {card.title}
                </span>
                {card.badge !== undefined && card.badge > 0 && (
                  <span className="inline-flex items-center rounded-full bg-error px-1.5 text-caption font-semibold text-content-inverse">
                    {card.badge}
                  </span>
                )}
                <LinkPendingSpinner />
              </div>
              <p className="text-caption text-content-muted mt-1">
                {card.description}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
