import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import {
  groupViewerBusinesses,
  type ViewerBusiness,
} from "./business-list-helpers";

export type { ViewerBusiness };

/**
 * The distinct businesses the authenticated viewer can access (via team
 * membership), sorted by display name. Drives the `/business`
 * single-business redirect and the hub header switcher. Membership-scoped
 * by RLS + `getUserTeams` — never surfaces a business the viewer has no
 * team in. Returns `[]` for a viewer with no teams.
 */
export async function getViewerBusinesses(): Promise<ViewerBusiness[]> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  if (teams.length === 0) return [];

  const teamIds = teams.map((t) => t.id);
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, business_id")
    .in("id", teamIds);
  const rows = (teamRows ?? []) as Array<{
    id: string;
    business_id: string | null;
  }>;

  const businessIds = [
    ...new Set(
      rows
        .map((r) => r.business_id)
        .filter((b): b is string => b !== null),
    ),
  ];
  const { data: bizRows } =
    businessIds.length > 0
      ? await supabase
          .from("businesses")
          .select("id, legal_name")
          .in("id", businessIds)
      : { data: [] };

  return groupViewerBusinesses(
    teams.map((t) => ({ id: t.id, name: t.name })),
    rows,
    (bizRows ?? []) as Array<{ id: string; legal_name: string | null }>,
  );
}
