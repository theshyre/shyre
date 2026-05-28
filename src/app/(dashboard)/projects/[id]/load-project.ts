import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";

/**
 * Shared project fetch + role resolution. `cache()`-wrapped so the
 * layout + the active sub-route (page.tsx, time/, expenses/,
 * settings/, history/) all share one network round-trip per request.
 *
 * Returns the raw `projects_v` row (any unknown — extended by each
 * sub-route's narrower type) plus the metadata every surface needs:
 * customer chip, parent breadcrumb, caller role, team + business id
 * for the deep-link from /projects/[id]/expenses out to the main
 * expenses surface.
 */
export interface LoadedProject {
  id: string;
  row: Record<string, unknown>;
  customer: { id: string; name: string } | null;
  parent: { id: string; name: string } | null;
  isInternal: boolean;
  callerUserId: string;
  callerRole: "owner" | "admin" | "member";
  callerIsAdmin: boolean;
  teamId: string;
  teamName: string;
  businessId: string;
}

export const loadProject = cache(
  async (id: string): Promise<LoadedProject> => {
    const supabase = await createClient();

    const { data: project } = await supabase
      .from("projects_v")
      .select("*, customers(id, name)")
      .eq("id", id)
      .single();
    if (!project) notFound();

    const { userId: callerUserId, role: callerRole } = await validateTeamAccess(
      project.team_id as string,
    );

    const customerObj =
      project.customers &&
      typeof project.customers === "object" &&
      "id" in project.customers
        ? (project.customers as { id: string | null; name: string | null })
        : null;
    const customer =
      customerObj?.id && customerObj.name
        ? { id: customerObj.id, name: customerObj.name }
        : null;

    let parent: { id: string; name: string } | null = null;
    if (project.parent_project_id) {
      const { data: parentRow } = await supabase
        .from("projects_v")
        .select("id, name")
        .eq("id", project.parent_project_id as string)
        .maybeSingle();
      if (parentRow) {
        parent = {
          id: parentRow.id as string,
          name: parentRow.name as string,
        };
      }
    }

    const { data: teamInfo } = await supabase
      .from("teams")
      .select("name, business_id")
      .eq("id", project.team_id)
      .single();

    return {
      id,
      row: project as Record<string, unknown>,
      customer,
      parent,
      isInternal: project.is_internal === true,
      callerUserId,
      callerRole: callerRole as "owner" | "admin" | "member",
      callerIsAdmin: callerRole === "owner" || callerRole === "admin",
      teamId: project.team_id as string,
      teamName: (teamInfo?.name as string | null) ?? "",
      businessId: (teamInfo?.business_id as string | null) ?? "",
    };
  },
);
