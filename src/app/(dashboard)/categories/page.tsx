import type { Metadata } from "next";
import { getUserTeams } from "@/lib/team-context";
import { getVisibleCategorySets } from "@/lib/categories/queries";
import { getTranslations } from "next-intl/server";
import { Tags } from "lucide-react";
import { CategoriesSection } from "./categories-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("categories");
  return { title: t("title") };
}

export default async function CategoriesPage(): Promise<React.JSX.Element> {
  const teams = await getUserTeams();
  const t = await getTranslations("categories");

  // Fetch visible sets across all user teams + system sets
  const sets = await getVisibleCategorySets();

  return (
    <div>
      <div className="flex items-center gap-3">
        <Tags size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>
      <p className="mt-2 text-sm text-content-secondary">{t("description")}</p>

      <CategoriesSection teams={teams} sets={sets} />
    </div>
  );
}
