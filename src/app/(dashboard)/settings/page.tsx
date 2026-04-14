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
    .select(
      "github_token, preferred_theme, timezone, locale, week_start, time_format",
    )
    .eq("user_id", user.userId)
    .maybeSingle();

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name, avatar_url")
    .eq("user_id", user.userId)
    .maybeSingle();

  return (
    <div>
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      <UserSettingsForm
        email={user.userEmail}
        displayName={profile?.display_name ?? ""}
        avatarUrl={profile?.avatar_url ?? ""}
        githubToken={userSettings?.github_token ?? null}
        preferredTheme={userSettings?.preferred_theme ?? null}
        timezone={userSettings?.timezone ?? null}
        locale={userSettings?.locale ?? null}
        weekStart={userSettings?.week_start ?? null}
        timeFormat={userSettings?.time_format ?? null}
      />
    </div>
  );
}
