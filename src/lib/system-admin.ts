import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Check if the current user is a system admin.
 */
export async function isSystemAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data } = await supabase
    .from("system_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  return data !== null;
}

/**
 * Require the current user to be a system admin.
 * Redirects to / if not.
 */
export async function requireSystemAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data } = await supabase
    .from("system_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .single();

  if (!data) redirect("/");

  return { userId: user.id };
}
