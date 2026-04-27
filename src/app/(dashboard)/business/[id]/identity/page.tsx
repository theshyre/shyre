import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";
import { IdentityForm } from "./identity-form";
import {
  StateRegistrationsSection,
  type StateRegistrationRow,
} from "./state-registrations-section";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BusinessIdentityPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { id: teamId } = await params;
  const t = await getTranslations("business.info");
  const supabase = await createClient();
  const { role } = await validateTeamAccess(teamId);
  const canEdit = role === "owner" || role === "admin";

  // Resolve the business that owns this team, then read identity.
  const { data: teamRow } = await supabase
    .from("teams")
    .select("business_id")
    .eq("id", teamId)
    .maybeSingle();
  const businessId = (teamRow?.business_id as string | null) ?? null;

  const [{ data: business }, { data: rawRegistrations }] = await Promise.all([
    businessId
      ? supabase
          .from("businesses")
          .select(
            "id, legal_name, entity_type, tax_id, date_incorporated, fiscal_year_start",
          )
          .eq("id", businessId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    businessId
      ? supabase
          .from("business_state_registrations")
          .select(
            "id, state, is_formation, registration_type, entity_number, state_tax_id, registered_on, nexus_start_date, registration_status, withdrawn_on, revoked_on, report_frequency, due_rule, annual_report_due_mmdd, next_due_date, annual_report_fee_cents, registered_agent_id, notes",
          )
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .order("is_formation", { ascending: false })
          .order("state", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const registrations = (rawRegistrations ?? []) as StateRegistrationRow[];

  return (
    <div className="space-y-4">
      <p className="text-body text-content-secondary max-w-3xl">{t("description")}</p>
      <IdentityForm
        teamId={teamId}
        businessId={(business?.id as string | null) ?? businessId ?? ""}
        legalName={(business?.legal_name as string | null) ?? ""}
        entityType={(business?.entity_type as string | null) ?? ""}
        taxId={(business?.tax_id as string | null) ?? ""}
        dateIncorporated={(business?.date_incorporated as string | null) ?? ""}
        fiscalYearStart={(business?.fiscal_year_start as string | null) ?? ""}
      />
      {businessId ? (
        <StateRegistrationsSection
          businessId={businessId}
          registrations={registrations}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}
