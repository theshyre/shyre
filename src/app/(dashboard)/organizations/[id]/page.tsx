import { createClient } from "@/lib/supabase/server";
import { validateOrgAccess, getUserContext } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { OrgSettingsForm } from "./org-settings-form";
import { TeamSection } from "../../../(dashboard)/settings/team-section";

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const { userId, role } = await validateOrgAccess(id);
  const user = await getUserContext();

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .single();

  if (!org) notFound();

  const { data: orgSettings } = await supabase
    .from("organization_settings")
    .select("*")
    .eq("organization_id", id)
    .single();

  const { data: members } = await supabase
    .from("organization_members")
    .select("id, user_id, role, joined_at, user_profiles(display_name)")
    .eq("organization_id", id)
    .order("joined_at");

  const { data: invites } = await supabase
    .from("organization_invites")
    .select("id, email, role, created_at, expires_at")
    .eq("organization_id", id)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center gap-3">
        <Building2 size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{org.name}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-content-muted">
          {role}
        </span>
      </div>

      <OrgSettingsForm
        orgSettings={orgSettings}
        orgId={id}
        role={role}
      />

      <TeamSection
        orgName={org.name}
        orgId={id}
        isPersonalOrg={false}
        currentRole={role}
        currentUserId={userId}
        members={members ?? []}
        invites={invites ?? []}
      />
    </div>
  );
}
