import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Upload } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams, validateBusinessAccess } from "@/lib/team-context";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";
import { ImportForm } from "./import-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses.import");
  return { title: t("title") };
}

interface PageProps {
  params: Promise<{ businessId: string }>;
}

/**
 * Bulk-import expenses for a single business. The team picker on
 * the form is scoped to teams in THIS business that the caller can
 * write to (owner|admin), so an agency owner doesn't accidentally
 * import a CSV into a team that belongs to a different holding LLC.
 *
 * Lives here, not under /import, because:
 *   - Expenses are entity-scoped (one business at a time)
 *   - The user's mental model is "go to Business → Expenses, then
 *     import" — having to leave that surface to find an importer
 *     under Settings was the friction the move addresses
 *   - Harvest stays at /import because it's truly cross-cutting
 *     (customers + projects + entries spanning the whole team)
 */
export default async function ExpensesImportPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const t = await getTranslations("expenses.import");

  // Role gate: must be owner|admin on at least one team in this
  // business. validateBusinessAccess returns the highest role across
  // teams in the business; we still filter the team picker to the
  // ones the caller can actually write to so the dropdown matches
  // what the action will accept.
  const { role } = await validateBusinessAccess(businessId);
  if (role !== "owner" && role !== "admin") {
    notFound();
  }

  const supabase = await createClient();
  const userTeams = await getUserTeams();
  const userTeamIds = userTeams.map((tm) => tm.id);
  const { data: businessTeams } =
    userTeamIds.length > 0
      ? await supabase
          .from("teams")
          .select("id")
          .eq("business_id", businessId)
          .in("id", userTeamIds)
      : { data: [] };
  const businessTeamIds = new Set(
    (businessTeams ?? []).map((row) => row.id as string),
  );

  // Owner|admin only. Filter the user's team list down to teams that
  // are (a) in this business and (b) writable by this caller.
  const writableTeams = userTeams.filter(
    (tm) =>
      businessTeamIds.has(tm.id) &&
      (tm.role === "owner" || tm.role === "admin"),
  );

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/business/${businessId}/expenses`}
          className="inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
        >
          <ArrowLeft size={12} />
          {t("backToExpenses")}
          <LinkPendingSpinner size={10} className="" />
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <Upload size={20} className="text-accent" />
          <h2 className="text-title font-bold text-content">{t("title")}</h2>
        </div>
        <p className="mt-2 text-body text-content-secondary max-w-2xl">
          {t("description")}
        </p>
      </div>

      <ImportForm teams={writableTeams} />
    </div>
  );
}
