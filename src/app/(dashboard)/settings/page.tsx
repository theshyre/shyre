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
} from "lucide-react";
import { isSystemAdmin } from "@/lib/system-admin";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import type { ComponentType } from "react";

interface Card {
  title: string;
  description: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.hub");
  return { title: t("title") };
}

/**
 * Settings hub (URL still /admin pending Tier 3 rename → /settings).
 *
 * After the four-persona IA review, this page only renders the
 * user-level settings cards. Sysadmin tooling moved to /system in
 * Tier 2 (separate route group with layout-level
 * requireSystemAdmin), and a sysadmin who lands here gets a
 * one-line callout linking to /system instead of the old conflated
 * card grid.
 */
export default async function SettingsHubPage(): Promise<React.JSX.Element> {
  const t = await getTranslations("admin.hub");
  const admin = await isSystemAdmin();

  const cards: Card[] = [
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
      </div>

      <p className="text-body text-content-secondary max-w-2xl">
        {t("description")}
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

      {admin && (
        <div className="rounded-lg border border-warning/40 bg-warning-soft/20 px-4 py-3 text-caption text-content-secondary">
          <Link
            href="/system"
            className="font-semibold text-warning hover:underline"
          >
            {t("systemSection")} →
          </Link>{" "}
          {t("systemSectionHint")}
        </div>
      )}
    </div>
  );
}
