import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Briefcase, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { BusinessSubNav } from "./business-sub-nav";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
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
  const { id } = await params;
  const t = await getTranslations("business");
  const supabase = await createClient();
  const teams = await getUserTeams();

  // Must be a member of this org. Otherwise show 404 (not 403; we don't
  // want to confirm the org's existence to outsiders).
  const membership = teams.find((o) => o.id === id);
  if (!membership) {
    // If they passed an invalid id, send them back to the list.
    if (teams.length === 0) redirect("/business");
    notFound();
  }

  // Identity lives on businesses, accessed via teams.business_id.
  const { data: teamRow } = await supabase
    .from("teams")
    .select("business_id")
    .eq("id", id)
    .maybeSingle();
  const businessId = (teamRow?.business_id as string | null) ?? null;

  const { data: business } = businessId
    ? await supabase
        .from("businesses")
        .select("legal_name, entity_type")
        .eq("id", businessId)
        .maybeSingle()
    : { data: null };

  const displayName =
    (business?.legal_name as string | null) ?? membership.name;
  const entityKey = business?.entity_type
    ? String(business.entity_type)
    : null;
  const entityLabel = entityKey
    ? (ENTITY_LABEL[entityKey] ?? entityKey)
    : null;

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
        </div>
      </div>

      <BusinessSubNav teamId={id} />

      {children}
    </div>
  );
}
