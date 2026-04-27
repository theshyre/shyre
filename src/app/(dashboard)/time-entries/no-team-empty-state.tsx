import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Clock, Users, Mail } from "lucide-react";

/**
 * Rendered on /time-entries when the user has no team memberships. A user
 * with zero teams can't log time anywhere — RLS requires membership and
 * the Start Timer form has no projects to show. Give them a clear next
 * step instead of a blank page.
 */
export async function NoTeamEmptyState(): Promise<React.JSX.Element> {
  const t = await getTranslations("time.noTeams");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Clock size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
      </div>

      <div className="rounded-lg border border-edge bg-surface-raised p-8 text-center max-w-[576px] mx-auto">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-text mb-4">
          <Users size={24} />
        </div>
        <h2 className="text-title font-semibold text-content mb-2">
          {t("headline")}
        </h2>
        <p className="text-body text-content-secondary mb-6">{t("body")}</p>

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            href="/teams"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-body-lg font-medium text-content-inverse hover:bg-accent-hover transition-colors"
          >
            <Users size={16} />
            {t("createTeam")}
          </Link>
          <a
            href={`mailto:support@malcom.io?subject=${encodeURIComponent(
              t("contactSubject"),
            )}`}
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-4 py-2 text-body-lg text-content-secondary hover:bg-hover transition-colors"
          >
            <Mail size={16} />
            {t("contactAdmin")}
          </a>
        </div>
      </div>
    </div>
  );
}
