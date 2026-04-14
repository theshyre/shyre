import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a Supabase client authenticated as a specific user.
 * Queries exercise RLS as that user.
 * Retries on rate-limit errors with exponential backoff.
 */
export async function createAuthedClient(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env vars for authed client");
  }

  const maxAttempts = 5;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await client.auth.signInWithPassword({ email, password });

    if (!error) return client;

    lastError = error.message;

    // Retry on rate limit with exponential backoff
    if (error.message.toLowerCase().includes("rate limit")) {
      const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s, 16s
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    // Non-rate-limit errors: fail immediately
    throw new Error(`Failed to sign in as ${email}: ${error.message}`);
  }

  throw new Error(
    `Failed to sign in as ${email} after ${maxAttempts} attempts: ${lastError}`,
  );
}
