import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const t = await getTranslations("settings");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: settings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user?.id ?? "")
    .single();

  return (
    <div>
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      <SettingsForm settings={settings} />
    </div>
  );
}
