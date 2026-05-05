import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cache } from "react";

/**
 * Check if the current user is a system admin.
 *
 * Wrapped in React `cache()` — layout, GlobalCommandPalette, and
 * admin pages all call this within a single request; without the
 * cache each path was paying its own auth + system_admins
 * round-trip.
 */
export const isSystemAdmin = cache(async (): Promise<boolean> => {
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
});

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
