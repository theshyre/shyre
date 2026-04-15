import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { IdentityForm } from "./identity-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BusinessIdentityPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { id: teamId } = await params;
  const t = await getTranslations("business.info");
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("team_settings")
    .select(
      "legal_name, entity_type, tax_id, state_registration_id, registered_state, date_incorporated, fiscal_year_start",
    )
    .eq("team_id", teamId)
    .maybeSingle();

  return (
    <div className="space-y-3">
      <p className="text-sm text-content-secondary max-w-3xl">{t("description")}</p>
      <IdentityForm
        teamId={teamId}
        legalName={(settings?.legal_name as string | null) ?? ""}
        entityType={(settings?.entity_type as string | null) ?? ""}
        taxId={(settings?.tax_id as string | null) ?? ""}
        stateRegistrationId={(settings?.state_registration_id as string | null) ?? ""}
        registeredState={(settings?.registered_state as string | null) ?? ""}
        dateIncorporated={(settings?.date_incorporated as string | null) ?? ""}
        fiscalYearStart={(settings?.fiscal_year_start as string | null) ?? ""}
      />
    </div>
  );
}
