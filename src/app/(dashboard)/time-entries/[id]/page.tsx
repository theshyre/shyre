import { createClient } from "@/lib/supabase/server";
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
  const t = await getTranslations("time");

  const { data: entry } = await supabase
    .from("time_entries")
    .select("*, projects(name)")
    .eq("id", id)
    .single();

  if (!entry) notFound();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("status", "active")
    .order("name");

  return (
    <div>
      <TimeEntryEditForm entry={entry} projects={projects ?? []} />
    </div>
  );
}
