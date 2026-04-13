import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface UserContext {
  userId: string;
  userEmail: string;
  displayName: string;
}

export interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

/**
 * Get the authenticated user's context (identity, not org-scoped).
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

/**
 * Get all organizations the current user belongs to.
 */
export async function getUserOrgs(): Promise<OrgListItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, slug)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  return (data ?? [])
    .map((m) => {
      const org =
        m.organizations &&
        typeof m.organizations === "object" &&
        "id" in m.organizations
          ? (m.organizations as unknown as { id: string; name: string; slug: string })
          : null;
      if (!org) return null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: m.role as "owner" | "admin" | "member",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Get all org IDs the current user belongs to.
 */
export async function getUserOrgIds(): Promise<string[]> {
  const orgs = await getUserOrgs();
  return orgs.map((o) => o.id);
}

/**
 * Validate that the current user has access to a specific org.
 * Returns the user's role if they have access, throws if they don't.
 */
export async function validateOrgAccess(
  orgId: string
): Promise<{ userId: string; role: "owner" | "admin" | "member" }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .single();

  if (!membership) {
    throw new Error("You do not have access to this organization.");
  }

  return {
    userId: user.id,
    role: membership.role as "owner" | "admin" | "member",
  };
}
