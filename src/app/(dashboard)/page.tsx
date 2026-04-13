import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { LayoutDashboard } from "lucide-react";

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = await getTranslations("dashboard");

  return (
    <div>
      <div className="flex items-center gap-3">
        <LayoutDashboard size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>
      <p className="mt-2 text-content-secondary">
        {t("welcomeBack", { email: user?.email ?? "" })}
      </p>
      <p className="mt-4 text-sm text-content-muted">
        {t("getStarted")}
      </p>
    </div>
  );
}
