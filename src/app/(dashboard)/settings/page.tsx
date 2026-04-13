import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { SettingsForm } from "./settings-form";
import { TeamSection } from "./team-section";

export default async function SettingsPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const ctx = await getOrgContext();
  const t = await getTranslations("settings");

  const { data: settings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", ctx.userId)
    .single();

  // Fetch org members
  const { data: members } = await supabase
    .from("organization_members")
    .select("id, user_id, role, joined_at")
    .eq("organization_id", ctx.orgId)
    .order("joined_at");

  // Fetch pending invites
  const { data: invites } = await supabase
    .from("organization_invites")
    .select("id, email, role, created_at, expires_at")
    .eq("organization_id", ctx.orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      <SettingsForm settings={settings} />

      <TeamSection
        orgName={ctx.orgName}
        orgId={ctx.orgId}
        currentRole={ctx.role}
        currentUserId={ctx.userId}
        members={members ?? []}
        invites={invites ?? []}
      />
    </div>
  );
}
