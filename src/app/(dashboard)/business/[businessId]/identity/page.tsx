import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { validateBusinessAccess } from "@/lib/team-context";
import { IdentityForm } from "./identity-form";
import {
  StateRegistrationsSection,
  type StateRegistrationRow,
} from "./state-registrations-section";

interface PageProps {
  params: Promise<{ businessId: string }>;
}

export default async function BusinessIdentityPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const t = await getTranslations("business.info");
  const supabase = await createClient();
  const { role } = await validateBusinessAccess(businessId);
  const canEdit = role === "owner" || role === "admin";

  const [{ data: business }, { data: rawRegistrations }] = await Promise.all([
    supabase
      .from("businesses")
      .select(
        "id, legal_name, entity_type, tax_id, date_incorporated, fiscal_year_start",
      )
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_state_registrations")
      .select(
        "id, state, is_formation, registration_type, entity_number, state_tax_id, registered_on, nexus_start_date, registration_status, withdrawn_on, revoked_on, report_frequency, due_rule, annual_report_due_mmdd, next_due_date, annual_report_fee_cents, registered_agent_id, notes",
      )
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("is_formation", { ascending: false })
      .order("state", { ascending: true }),
  ]);

  const registrations = (rawRegistrations ?? []) as StateRegistrationRow[];

  return (
    <div className="space-y-4">
      <p className="text-body text-content-secondary max-w-3xl">{t("description")}</p>
      <IdentityForm
        businessId={businessId}
        legalName={(business?.legal_name as string | null) ?? ""}
        entityType={(business?.entity_type as string | null) ?? ""}
        taxId={(business?.tax_id as string | null) ?? ""}
        dateIncorporated={(business?.date_incorporated as string | null) ?? ""}
        fiscalYearStart={(business?.fiscal_year_start as string | null) ?? ""}
      />
      <StateRegistrationsSection
        businessId={businessId}
        registrations={registrations}
        canEdit={canEdit}
      />
    </div>
  );
}
