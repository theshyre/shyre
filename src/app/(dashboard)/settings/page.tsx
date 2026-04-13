import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import { SettingsForm } from "./settings-form";
import { TeamSection } from "./team-section";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const { org: selectedOrgId } = await searchParams;
  const t = await getTranslations("settings");

  // Use selected org or default to first org
  const firstOrg = orgs[0];
  const activeOrgId = selectedOrgId ?? firstOrg?.id ?? "";
  const activeOrg = orgs.find(o => o.id === activeOrgId);
  const activeRole = activeOrg?.role ?? "member";

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  // Org-scoped settings (business info, rates)
  const { data: orgSettings } = await supabase
    .from("organization_settings")
    .select("*")
    .eq("organization_id", activeOrgId)
    .single();

  // User-scoped settings (github token)
  const { data: userSettings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user!.id)
    .single();

  // Fetch org members with profiles
  const { data: members } = await supabase
    .from("organization_members")
    .select("id, user_id, role, joined_at, user_profiles(display_name)")
    .eq("organization_id", activeOrgId)
    .order("joined_at");

  // Fetch pending invites
  const { data: invites } = await supabase
    .from("organization_invites")
    .select("id, email, role, created_at, expires_at")
    .eq("organization_id", activeOrgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={selectedOrgId ?? null} />
      </div>

      <SettingsForm
        orgSettings={orgSettings}
        userSettings={userSettings}
        role={activeRole}
        orgId={activeOrgId}
      />

      <TeamSection
        orgName={activeOrg?.name ?? ""}
        orgId={activeOrgId}
        isPersonalOrg={orgs.length === 1}
        currentRole={activeRole}
        currentUserId={user!.id}
        members={members ?? []}
        invites={invites ?? []}
      />
    </div>
  );
}
