import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ShieldAlert,
  AlertTriangle,
  Users,
  ListTree,
  Database,
  Cloud,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
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
  return { title: "System" };
}

/**
 * /system hub — landing page for sysadmin tooling.
 *
 * Auth is enforced one level up at /system/layout.tsx via
 * requireSystemAdmin(); this page assumes the caller passed the
 * gate. The layout also renders the env-misconfig banner when
 * SUPABASE_SERVICE_ROLE_KEY etc. are missing.
 *
 * Replaces the "System administration" section that used to live
 * inside /admin (now /settings) — sysadmin tools were conflated
 * with user-level configuration on the same page, which the four-
 * persona review flagged as the root cause of the
 * "Teams" / "All Teams" labeling collision.
 */
export default async function SystemHubPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("admin.hub");
  const supabase = await createClient();
  const { count: unresolvedErrorCount } = await supabase
    .from("error_logs")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);

  const cards: Card[] = [
    {
      title: t("cards.errorLog.title"),
      description: t("cards.errorLog.description"),
      href: "/system/errors",
      icon: AlertTriangle,
      badge: unresolvedErrorCount ?? 0,
    },
    {
      title: t("cards.users.title"),
      description: t("cards.users.description"),
      href: "/system/users",
      icon: Users,
    },
    {
      title: t("cards.allTeams.title"),
      description: t("cards.allTeams.description"),
      href: "/system/teams",
      icon: ListTree,
    },
    {
      title: t("cards.sampleData.title"),
      description: t("cards.sampleData.description"),
      href: "/system/sample-data",
      icon: Database,
    },
    {
      title: t("cards.deploy.title"),
      description: t("cards.deploy.description"),
      href: "/system/deploy",
      icon: Cloud,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert size={24} className="text-warning" />
        <h1 className="text-page-title font-bold text-content">
          {t("systemSection")}
        </h1>
      </div>
      <p className="text-body text-content-secondary max-w-3xl">
        {t("systemSectionHint")}
      </p>
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
    </div>
  );
}
