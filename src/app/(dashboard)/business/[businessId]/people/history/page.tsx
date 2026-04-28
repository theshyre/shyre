import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft, Download, History as HistoryIcon } from "lucide-react";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { validateBusinessAccess } from "@/lib/team-context";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("business.people.history");
  return { title: t("businessPageTitle") };
}
import {
  getBusinessPeopleHistoryAction,
  type BusinessPersonHistoryEntry,
} from "../../../people-actions";
import { HistoryTimeline } from "./history-timeline";
import { HistoryFilters, type FilterCandidates } from "./history-filters";

interface PageProps {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(
  value: string | string[] | undefined,
): string | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  return v.trim() || null;
}

export default async function BusinessPeopleHistoryPage({
  params,
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const sp = await searchParams;
  const t = await getTranslations("business.people.history");

  // Authorization is double-belted: validateBusinessAccess gates the
  // page render (throws on no membership), and bph_select RLS gates
  // each row independently (owner/admin sees everything in the
  // business; other users see only their own person record's entries).
  await validateBusinessAccess(businessId);

  const filters = {
    from: pickString(sp.from),
    to: pickString(sp.to),
    personId: pickString(sp.personId),
    actorUserId: pickString(sp.actorUserId),
  };

  // Build CSV link with the same filters so the export reflects the
  // user's current view, not the unfiltered firehose.
  const csvParams = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) csvParams.set(k, v);
  }
  const csvHref =
    `/api/business/${businessId}/people-history/csv` +
    (csvParams.toString() ? `?${csvParams.toString()}` : "");

  // Resolve filter candidate lists server-side: every active person
  // in the business + every actor who's appeared in the history.
  const supabase = await createClient();
  const [{ data: peopleRows }, { data: actorRows }] = await Promise.all([
    supabase
      .from("business_people")
      .select("id, legal_name, preferred_name")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("legal_name", { ascending: true }),
    supabase
      .from("business_people_history")
      .select("changed_by_user_id")
      .eq("business_id", businessId)
      .not("changed_by_user_id", "is", null),
  ]);
  const actorIds = Array.from(
    new Set(
      (actorRows ?? [])
        .map((r) => r.changed_by_user_id as string | null)
        .filter((id): id is string => id !== null),
    ),
  );
  const { data: actorProfiles } =
    actorIds.length > 0
      ? await supabase
          .from("user_profiles")
          .select("user_id, display_name")
          .in("user_id", actorIds)
      : { data: [] };
  const candidates: FilterCandidates = {
    people: (peopleRows ?? []).map((p) => ({
      id: p.id as string,
      name:
        ((p.preferred_name as string | null) ?? null) ||
        (p.legal_name as string | null) ||
        "Unknown",
    })),
    actors: (actorProfiles ?? [])
      .map((p) => ({
        userId: p.user_id as string,
        name: (p.display_name as string | null) ?? "Unknown user",
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  const { history, hasMore } = await getBusinessPeopleHistoryAction(
    businessId,
    { limit: 200, ...filters },
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
          {history.length > 0 && (
            <a
              href={csvHref}
              download
              className={`${buttonSecondaryClass} inline-flex items-center gap-1.5 ml-auto`}
            >
              <Download size={14} />
              {t("exportCsv")}
            </a>
          )}
        </div>
        <p className="mt-2 text-body text-content-secondary max-w-3xl">
          {t("businessPageDescription")}
        </p>
      </div>

      <HistoryFilters
        businessId={businessId}
        currentFilters={filters}
        candidates={candidates}
      />

      {history.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-6 text-body text-content-muted italic">
          {t("businessEmpty")}
        </p>
      ) : (
        <HistoryTimeline
          businessId={businessId}
          entries={history as BusinessPersonHistoryEntry[]}
          hasMore={hasMore}
          filters={filters}
        />
      )}
    </div>
  );
}
