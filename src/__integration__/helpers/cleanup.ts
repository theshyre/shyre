import { adminClient } from "./admin";
import { TEST_PREFIX_ROOT, TEST_EMAIL_DOMAIN } from "./prefix";

/**
 * Delete all data matching the test prefix root (itest-%).
 * Idempotent — safe to run before and after tests to catch crashed-run leftovers.
 */
export async function cleanupAllTestData(): Promise<void> {
  await cleanupByPattern(`${TEST_PREFIX_ROOT}%`);
}

/**
 * Delete all data matching a specific run prefix.
 * Call in afterAll() to clean up after a test file.
 */
export async function cleanupPrefix(prefix: string): Promise<void> {
  if (!prefix.startsWith(TEST_PREFIX_ROOT)) {
    throw new Error(
      `Refusing to cleanup non-test prefix: "${prefix}". Must start with "${TEST_PREFIX_ROOT}"`,
    );
  }
  await cleanupByPattern(`${prefix}%`);
}

/**
 * Internal: delete all test data matching a LIKE pattern.
 * Safety: pattern MUST contain the test prefix root.
 */
async function cleanupByPattern(pattern: string): Promise<void> {
  if (!pattern.startsWith(TEST_PREFIX_ROOT)) {
    throw new Error(
      `Refusing to cleanup: pattern "${pattern}" does not start with "${TEST_PREFIX_ROOT}"`,
    );
  }

  const admin = adminClient();

  // Get all test orgs first — we'll cascade-delete most data via these.
  //
  // The handle_new_user trigger derives org NAME from the user's email
  // ("itest-foo@stint-test.local" → "itest-foo's Organization") but auto-
  // generates the slug as "org-{uuid}". So name matches the test prefix;
  // slug does NOT. Filter by name to actually catch them.
  const { data: testOrgs } = await admin
    .from("organizations")
    .select("id")
    .like("name", pattern);

  const orgIds = (testOrgs ?? []).map((o) => o.id);

  // Delete child rows first (though FKs will cascade, we want explicit cleanup
  // for anything not tied to an org — e.g. records using test user_ids in other orgs)

  if (orgIds.length > 0) {
    // Cascade deletes will handle most of this, but do it explicitly for clarity.
    await admin.from("time_entries").delete().in("organization_id", orgIds);
    await admin.from("invoices").delete().in("organization_id", orgIds);
    await admin.from("projects").delete().in("organization_id", orgIds);
    await admin.from("category_sets").delete().in("organization_id", orgIds);
    await admin.from("customer_shares").delete().in("organization_id", orgIds);
    await admin.from("customers").delete().in("organization_id", orgIds);
    await admin.from("security_group_members").delete().in("group_id",
      (await admin.from("security_groups").select("id").in("organization_id", orgIds)).data?.map(g => g.id) ?? []
    );
    await admin.from("security_groups").delete().in("organization_id", orgIds);
    await admin.from("organization_shares").delete().in("parent_org_id", orgIds);
    await admin.from("organization_shares").delete().in("child_org_id", orgIds);
    await admin.from("organization_invites").delete().in("organization_id", orgIds);
    await admin.from("organization_members").delete().in("organization_id", orgIds);
    await admin.from("organization_settings").delete().in("organization_id", orgIds);
    await admin.from("organizations").delete().in("id", orgIds);
  }

  // Delete test auth users (they're prefixed by email)
  // Supabase doesn't support pattern matching in admin.listUsers filter,
  // so we page through and filter client-side.
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data.users.length) break;

    const testUsers = data.users.filter((u) =>
      u.email?.endsWith(TEST_EMAIL_DOMAIN) &&
      u.email.includes(TEST_PREFIX_ROOT)
    );

    for (const user of testUsers) {
      await admin.auth.admin.deleteUser(user.id);
    }

    if (data.users.length < perPage) break;
    page++;
    // Safety: cap at 50 pages (5000 test users)
    if (page > 50) break;
  }
}

/**
 * Count test data rows — for verification that cleanup worked.
 */
export async function countTestData(): Promise<{
  orgs: number;
  users: number;
}> {
  const admin = adminClient();
  // Match by name — see note in cleanupByPattern on why slug doesn't catch these.
  const { count: orgs } = await admin
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .like("name", `${TEST_PREFIX_ROOT}%`);

  const { data } = await admin.auth.admin.listUsers();
  const users = (data?.users ?? []).filter((u) =>
    u.email?.endsWith(TEST_EMAIL_DOMAIN) && u.email.includes(TEST_PREFIX_ROOT)
  ).length;

  return { orgs: orgs ?? 0, users };
}
