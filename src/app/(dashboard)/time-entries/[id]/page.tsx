import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { TimeEntryEditForm } from "./time-entry-edit-form";

export default async function TimeEntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const { orgId } = await getOrgContext();
  const t = await getTranslations("time");

  const { data: entry } = await supabase
    .from("time_entries")
    .select("*, projects(name)")
    .eq("organization_id", orgId)
    .eq("id", id)
    .single();

  if (!entry) notFound();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("name");

  return (
    <div>
      <TimeEntryEditForm entry={entry} projects={projects ?? []} />
    </div>
  );
}
