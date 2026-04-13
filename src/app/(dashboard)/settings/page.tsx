import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { UserSettingsForm } from "./user-settings-form";

export default async function SettingsPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const user = await getUserContext();
  const t = await getTranslations("settings");

  const { data: userSettings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.userId)
    .single();

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", user.userId)
    .single();

  return (
    <div>
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      <UserSettingsForm
        githubToken={userSettings?.github_token ?? null}
        displayName={profile?.display_name ?? ""}
      />
    </div>
  );
}
