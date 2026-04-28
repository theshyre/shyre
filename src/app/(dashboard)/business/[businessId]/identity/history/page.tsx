import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft, Download, History as HistoryIcon } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { validateBusinessAccess } from "@/lib/team-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("business.info.history");
  return { title: t("title") };
}
import { getBusinessIdentityHistoryAction } from "../../../actions";
import { IdentityHistoryTimeline } from "./identity-history-timeline";

interface PageProps {
  params: Promise<{ businessId: string }>;
}

export default async function BusinessIdentityHistoryPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const t = await getTranslations("business.info.history");
  // Owner|admin only — RLS on the two history tables already
  // enforces this; the explicit check produces a friendlier "you
  // don't have access" rather than an empty page for plain members.
  const { role } = await validateBusinessAccess(businessId);
  const isAdmin = role === "owner" || role === "admin";

  const { history, hasMore } = isAdmin
    ? await getBusinessIdentityHistoryAction(businessId, { limit: 200 })
    : { history: [], hasMore: false };

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/business/${businessId}/identity`}
          className="inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
        >
          <ArrowLeft size={12} />
          {t("backToIdentity")}
          <LinkPendingSpinner size={10} className="" />
        </Link>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <HistoryIcon size={20} className="text-accent" />
          <h2 className="text-title font-semibold text-content">
            {t("title")}
          </h2>
          <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-muted">
            {t("entryCount", { count: history.length })}
          </span>
          {history.length > 0 && (
            <a
              href={`/api/business/${businessId}/identity-history/csv`}
              download
              className={`${buttonSecondaryClass} inline-flex items-center gap-1.5 ml-auto`}
            >
              <Download size={14} />
              {t("exportCsv")}
            </a>
          )}
        </div>
        <p className="mt-2 text-body text-content-secondary max-w-3xl">
          {t("description")}
        </p>
      </div>

      {!isAdmin ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted italic">
          {t("notAdmin")}
        </p>
      ) : history.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted italic">
          {t("empty")}
        </p>
      ) : (
        <IdentityHistoryTimeline
          businessId={businessId}
          entries={history}
          hasMore={hasMore}
        />
      )}
    </div>
  );
}
