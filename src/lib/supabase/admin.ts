import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client with service role key — bypasses RLS.
 * ONLY used server-side for error logging and system admin operations.
 * Never import this from client components.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !key && "SUPABASE_SERVICE_ROLE_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    // Loud console.error so Vercel runtime logs surface the cause even
    // when the thrown error is hidden behind Next's generic error page.
    console.error(
      `[createAdminClient] Missing required env var(s): ${missing}. ` +
        "Admin-only pages (/admin/users, /admin/teams) and the " +
        "error logger will fail until this is set in the deployment " +
        "environment.",
    );
    throw new Error(`Missing required env var(s): ${missing}`);
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
