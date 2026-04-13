import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { Clock } from "lucide-react";
import { TimerStartForm } from "./timer-start-form";

export default async function TimerPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const { orgId } = await getOrgContext();
  const t = await getTranslations("time.timer");

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("name");

  const { data: runningEntries } = await supabase
    .from("time_entries")
    .select("id, project_id, description, start_time, projects(name)")
    .eq("organization_id", orgId)
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1);

  const running = runningEntries?.[0] ?? null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Clock size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      <TimerStartForm
        projects={projects ?? []}
        running={running}
      />
    </div>
  );
}
