import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { Briefcase } from "lucide-react";
import Link from "next/link";
import { buttonGhostClass } from "@/lib/form-styles";
import { BusinessInfoForm } from "./business-info-form";

export default async function BusinessInfoPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const t = await getTranslations("business");
  const { org: requestedOrgId } = await searchParams;

  const orgId = requestedOrgId ?? orgs[0]?.id ?? null;

  let settings: Record<string, unknown> | null = null;
  if (orgId) {
    const { data } = await supabase
      .from("organization_settings")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    settings = data;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Briefcase size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">
          {t("info.title")}
        </h1>
      </div>
      <Link href="/business" className={buttonGhostClass}>
        ← {t("info.back")}
      </Link>

      <BusinessInfoForm
        orgs={orgs}
        orgId={orgId}
        legalName={getStr(settings, "legal_name")}
        entityType={getStr(settings, "entity_type")}
        taxId={getStr(settings, "tax_id")}
        stateRegistrationId={getStr(settings, "state_registration_id")}
        registeredState={getStr(settings, "registered_state")}
        dateIncorporated={getStr(settings, "date_incorporated")}
        fiscalYearStart={getStr(settings, "fiscal_year_start")}
      />
    </div>
  );
}

function getStr(
  settings: Record<string, unknown> | null,
  key: string,
): string {
  if (!settings) return "";
  const v = settings[key];
  return v == null ? "" : String(v);
}
