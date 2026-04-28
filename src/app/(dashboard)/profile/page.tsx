import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { User as UserIcon } from "lucide-react";
import { ProfileForm } from "./profile-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const user = await getUserContext();
  const t = await getTranslations("profile");

  const { data: userSettings } = await supabase
    .from("user_settings")
    .select(
      "github_token, jira_base_url, jira_email, jira_api_token, preferred_theme, timezone, locale, week_start, time_format",
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
        <UserIcon size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>
      <p className="mt-1 text-sm text-content-secondary">{t("subtitle")}</p>

      <ProfileForm
        userId={user.userId}
        email={user.userEmail}
        displayName={profile?.display_name ?? ""}
        avatarUrl={profile?.avatar_url ?? ""}
        githubToken={userSettings?.github_token ?? null}
        jiraBaseUrl={userSettings?.jira_base_url ?? null}
        jiraEmail={userSettings?.jira_email ?? null}
        jiraApiToken={userSettings?.jira_api_token ?? null}
        preferredTheme={userSettings?.preferred_theme ?? null}
        timezone={userSettings?.timezone ?? null}
        locale={userSettings?.locale ?? null}
        weekStart={userSettings?.week_start ?? null}
        timeFormat={userSettings?.time_format ?? null}
      />
    </div>
  );
}
