import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface UserContext {
  userId: string;
  userEmail: string;
  displayName: string;
}

export interface TeamListItem {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

/**
 * Get the authenticated user's context (identity, not team-scoped).
 * Redirects to /login if not authenticated.
 */
export async function getUserContext(): Promise<UserContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .single();

  return {
    userId: user.id,
    userEmail: user.email ?? "",
    displayName: profile?.display_name ?? user.email?.split("@")[0] ?? "User",
  };
}

/** Get all teams the current user belongs to. */
export async function getUserTeams(): Promise<TeamListItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data } = await supabase
    .from("team_members")
    .select("role, teams(id, name, slug)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  return (data ?? [])
    .map((m) => {
      const team =
        m.teams &&
        typeof m.teams === "object" &&
        "id" in m.teams
          ? (m.teams as unknown as { id: string; name: string; slug: string })
          : null;
      if (!team) return null;
      return {
        id: team.id,
        name: team.name,
        slug: team.slug,
        role: m.role as "owner" | "admin" | "member",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Get all team IDs the current user belongs to. */
export async function getUserTeamIds(): Promise<string[]> {
  const teams = await getUserTeams();
  return teams.map((t) => t.id);
}

/**
 * Validate that the current user has access to a specific team.
 * Returns the user's role if they have access, throws if they don't.
 */
export async function validateTeamAccess(
  teamId: string,
): Promise<{ userId: string; role: "owner" | "admin" | "member" }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("team_id", teamId)
    .single();

  if (!membership) {
    throw new Error("You do not have access to this team.");
  }

  return {
    userId: user.id,
    role: membership.role as "owner" | "admin" | "member",
  };
}

/**
 * Validate the current user has access to a business via membership in
 * any of its teams. Returns the highest role they hold across those
 * teams (`owner` > `admin` > `member`). Throws if no access — the
 * caller decides whether to show notFound or surface the error.
 *
 * IMPORTANT: the returned `role` is the *aggregate* maximum across
 * every team in the business, NOT the role on any specific team.
 * Don't use it as a gate for a per-team write — a user who is
 * owner of team A and member of team B will return `owner` here
 * even though they can only write team-A scoped rows. For per-team
 * writes use `validateTeamAccess(teamId)` instead, and to surface
 * a list of teams the caller can manage filter `getUserTeams()` by
 * `role IN ('owner','admin')` (see period-locks page for the
 * canonical example after SAL-014).
 */
export async function validateBusinessAccess(
  businessId: string,
): Promise<{ userId: string; role: "owner" | "admin" | "member" }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("user_business_role", {
    business_id: businessId,
  });
  if (error) throw error;

  const role = data as "owner" | "admin" | "member" | null;
  if (!role) {
    throw new Error("You do not have access to this business.");
  }

  return { userId: user.id, role };
}
