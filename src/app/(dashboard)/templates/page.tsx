import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getMyTemplates } from "@/lib/templates/queries";
import { getVisibleCategorySets } from "@/lib/categories/queries";
import { getTranslations } from "next-intl/server";
import { Bookmark } from "lucide-react";
import { TemplatesSection } from "./templates-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates");
  return { title: t("title") };
}

export default async function TemplatesPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("templates");

  const templates = await getMyTemplates();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, team_id, category_set_id")
    .eq("status", "active")
    .order("name");

  // All categories visible to any of the user's sets
  const sets = await getVisibleCategorySets();
  const categories = sets.flatMap((s) =>
    s.categories.map((c) => ({
      id: c.id,
      category_set_id: c.category_set_id,
      name: c.name,
      color: c.color,
      sort_order: c.sort_order,
    })),
  );

  return (
    <div>
      <div className="flex items-center gap-3">
        <Bookmark size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>
      <p className="mt-2 text-sm text-content-secondary">{t("description")}</p>

      <TemplatesSection
        teams={teams}
        templates={templates}
        projects={projects ?? []}
        categories={categories}
      />
    </div>
  );
}
