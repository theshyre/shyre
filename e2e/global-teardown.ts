import { createClient } from "@supabase/supabase-js";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function globalTeardown(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Clean up all itest- data
  const { data: orgs } = await admin
    .from("organizations")
    .select("id")
    .like("slug", "itest-%");

  const orgIds = (orgs ?? []).map((o) => o.id);

  if (orgIds.length > 0) {
    await admin.from("organizations").delete().in("id", orgIds);
  }

  const { data: users } = await admin.auth.admin.listUsers();
  for (const u of users?.users ?? []) {
    if (u.email?.includes("itest-") && u.email?.endsWith("@stint-test.local")) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

export default globalTeardown;
