import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft, History as HistoryIcon } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { validateBusinessAccess } from "@/lib/team-context";
import {
  getBusinessPeopleHistoryAction,
  type BusinessPersonHistoryEntry,
} from "../../../people-actions";
import { HistoryTimeline } from "./history-timeline";

interface PageProps {
  params: Promise<{ businessId: string }>;
}

export default async function BusinessPeopleHistoryPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const t = await getTranslations("business.people.history");
  // Authorization is double-belted: validateBusinessAccess gates the
  // page render (throws on no membership), and bph_select RLS gates
  // each row independently (owner/admin sees everything in the
  // business; other users see only their own person record's entries).
  await validateBusinessAccess(businessId);

  const { history, hasMore } = await getBusinessPeopleHistoryAction(
    businessId,
    { limit: 200 },
  );

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/business/${businessId}/people`}
          className="inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
        >
          <ArrowLeft size={12} />
          {t("backToPeople")}
          <LinkPendingSpinner size={10} className="" />
        </Link>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <HistoryIcon size={20} className="text-accent" />
          <h2 className="text-title font-semibold text-content">
            {t("businessPageTitle")}
          </h2>
          <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-muted">
            {t("entryCount", { count: history.length })}
          </span>
        </div>
        <p className="mt-2 text-body text-content-secondary max-w-3xl">
          {t("businessPageDescription")}
        </p>
      </div>

      {history.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted italic">
          {t("businessEmpty")}
        </p>
      ) : (
        <HistoryTimeline
          businessId={businessId}
          entries={history as BusinessPersonHistoryEntry[]}
          hasMore={hasMore}
        />
      )}
    </div>
  );
}
