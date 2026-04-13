import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface OrgContext {
  orgId: string;
  orgName: string;
  orgSlug: string;
  userId: string;
  userEmail: string;
  role: "owner" | "admin" | "member";
}

const ORG_COOKIE = "stint-org-id";

/**
 * Get the current organization context for the authenticated user.
 * Reads org ID from cookie, falling back to the user's first org.
 * Redirects to /login if not authenticated.
 */
export async function getOrgContext(): Promise<OrgContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const storedOrgId = cookieStore.get(ORG_COOKIE)?.value;

  // Try stored org first, then fall back to first membership
  let membership;

  if (storedOrgId) {
    const { data } = await supabase
      .from("organization_members")
      .select("organization_id, role, organizations(id, name, slug)")
      .eq("user_id", user.id)
      .eq("organization_id", storedOrgId)
      .single();
    membership = data;
  }

  if (!membership) {
    const { data } = await supabase
      .from("organization_members")
      .select("organization_id, role, organizations(id, name, slug)")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: true })
      .limit(1)
      .single();
    membership = data;
  }

  if (!membership) {
    // User has no org — this shouldn't happen (trigger creates one on signup)
    redirect("/login");
  }

  const org =
    membership.organizations &&
    typeof membership.organizations === "object" &&
    "id" in membership.organizations
      ? (membership.organizations as unknown as { id: string; name: string; slug: string })
      : null;

  if (!org) redirect("/login");

  return {
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
    userId: user.id,
    userEmail: user.email ?? "",
    role: membership.role as "owner" | "admin" | "member",
  };
}

/**
 * Get all organizations the current user belongs to.
 */
export async function getUserOrgs(): Promise<
  Array<{ id: string; name: string; slug: string; role: string }>
> {
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
      return { id: org.id, name: org.name, slug: org.slug, role: m.role };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
