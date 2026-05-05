import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Trash2, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDurationHMZero } from "@/lib/time/week";
import { TrashList } from "./trash-list";
import { parseListPagination } from "@/lib/pagination/list-pagination";
import { PaginationFooter } from "@/components/PaginationFooter";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("time.trash");
  return { title: t("title") };
}

interface PageProps {
  searchParams: Promise<{ limit?: string }>;
}

export default async function TimeEntriesTrashPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const t = await getTranslations("time.trash");
  const supabase = await createClient();
  const { limit } = parseListPagination(await searchParams);

  // Replaces the previous hardcoded `.limit(200)` with the
  // standard list-page pagination shape — count: "exact" + range
  // + id tiebreaker. The deleted_at sort already implies "newest
  // trashed first," but rows trashed in the same ms (bulk delete)
  // need the id tiebreaker for stable .range() across "Load more".
  const { data: rows, count: matchingCount } = await supabase
    .from("time_entries")
    .select(
      "id, start_time, end_time, duration_min, description, billable, deleted_at, projects(name, customers(name)), categories(name, color)",
      { count: "exact" },
    )
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, limit - 1);

  const entries = (rows ?? []).map((r) => ({
    id: r.id,
    start_time: r.start_time,
    end_time: r.end_time,
    duration_min: r.duration_min,
    description: r.description,
    billable: r.billable,
    deleted_at: r.deleted_at,
    project_name: pickProjectName(r.projects),
    customer_name: pickCustomerName(r.projects),
    category: pickCategory(r.categories),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Trash2 size={24} className="text-error" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
        <Link
          href="/time-entries"
          className="ml-auto inline-flex items-center gap-1 text-body-lg text-content-secondary hover:text-content"
        >
          <ArrowLeft size={14} />
          {t("back")}
        </Link>
      </div>

      <p className="text-body-lg text-content-muted">{t("description")}</p>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-edge bg-surface-raised px-6 py-12 text-center text-body-lg text-content-muted">
          {t("empty")}
        </div>
      ) : (
        <>
          <TrashList
            entries={entries}
            formatDuration={(m) => formatDurationHMZero(m ?? 0)}
          />
          <PaginationFooter
            loaded={entries.length}
            total={matchingCount ?? entries.length}
          />
        </>
      )}
    </div>
  );
}

function pickProjectName(p: unknown): string {
  if (!p || typeof p !== "object") return "—";
  const obj = p as { name?: string };
  return obj.name ?? "—";
}

function pickCustomerName(p: unknown): string | null {
  if (!p || typeof p !== "object") return null;
  const obj = p as { customers?: unknown };
  const customers = obj.customers;
  const first = Array.isArray(customers) ? customers[0] : customers;
  if (first && typeof first === "object" && "name" in first) {
    return (first as { name: string }).name;
  }
  return null;
}

function pickCategory(c: unknown): { name: string; color: string } | null {
  if (!c) return null;
  const first = Array.isArray(c) ? c[0] : c;
  if (first && typeof first === "object" && "name" in first && "color" in first) {
    return first as { name: string; color: string };
  }
  return null;
}
