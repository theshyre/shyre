import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const ALLOWED_HOSTS = ["onbdbngemtbrnstjnbns.supabase.co"];

export async function setup(): Promise<void> {
  // Env validation
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY — did .env.local load?",
    );
  }

  // Host allow-list — prevents accidental test runs against wrong DB
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to run integration tests against ${host}. ` +
        `Allowed hosts: ${ALLOWED_HOSTS.join(", ")}`,
    );
  }

  // Clean up any stragglers from previous crashed runs
  const { cleanupAllTestData, countTestData } = await import(
    "./helpers/cleanup"
  );

  const before = await countTestData();
  if (before.orgs > 0 || before.users > 0) {
    console.log(
      `[global-setup] Cleaning ${before.orgs} stale test orgs and ${before.users} stale test users...`,
    );
    await cleanupAllTestData();
  }
}

export async function teardown(): Promise<void> {
  const { cleanupAllTestData } = await import("./helpers/cleanup");
  await cleanupAllTestData();
}
