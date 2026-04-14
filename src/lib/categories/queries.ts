import { createClient } from "@/lib/supabase/server";
import type { Category, CategorySet, CategorySetWithCategories } from "./types";

/**
 * Fetch all category sets visible to the current user:
 * - all system sets
 * - the user's org(s) sets (if `orgId` is provided, filter to that org)
 * Ordered: system sets first (alphabetical), then org sets (alphabetical).
 */
export async function getVisibleCategorySets(
  orgId?: string,
): Promise<CategorySetWithCategories[]> {
  const supabase = await createClient();

  let setsQuery = supabase
    .from("category_sets")
    .select("*")
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });

  if (orgId) {
    // system OR this org
    setsQuery = setsQuery.or(`is_system.eq.true,organization_id.eq.${orgId}`);
  }

  const { data: sets } = await setsQuery;
  if (!sets || sets.length === 0) return [];

  const setIds = sets.map((s) => s.id);
  const { data: cats } = await supabase
    .from("categories")
    .select("*")
    .in("category_set_id", setIds)
    .order("sort_order", { ascending: true });

  const byId = new Map<string, Category[]>();
  for (const c of cats ?? []) {
    const list = byId.get(c.category_set_id) ?? [];
    list.push(c);
    byId.set(c.category_set_id, list);
  }

  return (sets as CategorySet[]).map((s) => ({
    ...s,
    categories: byId.get(s.id) ?? [],
  }));
}

/**
 * Fetch a single category set + its categories. Returns null if not visible.
 */
export async function getCategorySet(
  id: string,
): Promise<CategorySetWithCategories | null> {
  const supabase = await createClient();
  const { data: set } = await supabase
    .from("category_sets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!set) return null;

  const { data: cats } = await supabase
    .from("categories")
    .select("*")
    .eq("category_set_id", id)
    .order("sort_order", { ascending: true });

  return { ...(set as CategorySet), categories: (cats ?? []) as Category[] };
}
