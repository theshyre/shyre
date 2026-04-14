import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Note: deliberately does NOT import from "@/lib/supabase/admin" because that
// has `import "server-only"` which breaks in a test environment.

let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — did .env.local load?"
    );
  }

  cached = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}

/**
 * Reset the cached admin client (for tests).
 */
export function resetAdminClient(): void {
  cached = null;
}
