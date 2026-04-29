import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Briefcase, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { validateBusinessAccess } from "@/lib/team-context";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { BusinessSubNav } from "./business-sub-nav";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ businessId: string }>;
}

const ENTITY_LABEL: Record<string, string> = {
  sole_prop: "Sole Proprietorship",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  nonprofit: "Nonprofit",
  other: "Other",
};

export default async function BusinessDetailLayout({
  children,
  params,
}: LayoutProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const t = await getTranslations("business");
  const supabase = await createClient();

  // Identity lives on the businesses table directly. RLS scopes the
  // SELECT — if the viewer doesn't have a team in this business, the
  // query returns null and we show 404 (not 403; we don't confirm
  // the business's existence to outsiders).
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, legal_name, entity_type")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) {
    notFound();
  }

  // Surface admin-tier tabs only when the caller actually has the
  // role; period-locks 404s for non-admins on the page side, but
  // hiding the tab keeps the UI honest.
  const { role } = await validateBusinessAccess(businessId);
  const canManagePeriodLocks = role === "owner" || role === "admin";

  // Header fallback chain: legal_name → name (seeded display name,
  // never null in practice — see businesses migration) → i18n
  // "Untitled business". Two unconfigured shells in the user's
  // dashboard must read distinctly; `name` is the column carrying
  // identity until legal_name is filled in.
  const legalName = (business.legal_name as string | null) ?? null;
  const seededName = (business.name as string | null) ?? null;
  const displayName = legalName ?? seededName ?? t("untitled");
  const entityKey = business.entity_type
    ? String(business.entity_type)
    : null;
  const entityLabel = entityKey
    ? (ENTITY_LABEL[entityKey] ?? entityKey)
    : null;
  // When legal_name is null, the entity-type pill is also empty
  // (you can't pick an entity type without committing to identity).
  // Surface a muted "Not yet configured" pill in the same slot so
  // every business detail header has redundant disambiguation.
  const showUnconfiguredPill = legalName === null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/business"
          className="inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
        >
          <ArrowLeft size={12} />
          {t("backToList")}
          <LinkPendingSpinner size={10} className="" />
        </Link>
        <div className="mt-1 flex items-center gap-3 flex-wrap">
          <Briefcase size={24} className="text-accent" />
          <h1 className="text-page-title font-bold text-content break-words">
            {displayName}
          </h1>
          {entityLabel && (
            <span className="inline-flex items-center rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-secondary">
              {entityLabel}
            </span>
          )}
          {showUnconfiguredPill && (
            <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning-soft/30 px-2 py-0.5 text-caption font-medium text-warning">
              {t("notConfigured")}
            </span>
          )}
        </div>
      </div>

      <BusinessSubNav
        businessId={businessId}
        canManagePeriodLocks={canManagePeriodLocks}
      />

      {children}
    </div>
  );
}
