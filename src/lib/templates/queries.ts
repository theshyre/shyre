import { createClient } from "@/lib/supabase/server";
import type { TimeTemplate } from "./types";

/**
 * Fetch the current user's time templates, optionally filtered to one org.
 * Ordered by last_used_at DESC, then sort_order, then name.
 */
export async function getMyTemplates(
  orgId?: string,
): Promise<TimeTemplate[]> {
  const supabase = await createClient();
  let q = supabase
    .from("time_templates")
    .select("*")
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return (data ?? []) as TimeTemplate[];
}
