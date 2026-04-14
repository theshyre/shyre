import { randomBytes } from "crypto";
import { adminClient } from "./admin";
import { assertTestPrefix, TEST_EMAIL_DOMAIN } from "./prefix";

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

function randomPassword(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Create a test user via Supabase admin API.
 * Email format: `{prefix}{label}{TEST_EMAIL_DOMAIN}` ensures prefix-based cleanup.
 */
export async function createTestUser(
  prefix: string,
  label = "u",
): Promise<TestUser> {
  assertTestPrefix(prefix, "prefix");
  const email = `${prefix}${label}${TEST_EMAIL_DOMAIN}`;
  const password = randomPassword();

  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`Failed to create test user ${email}: ${error?.message}`);
  }

  return { id: data.user.id, email, password };
}

export async function deleteTestUser(userId: string): Promise<void> {
  await adminClient().auth.admin.deleteUser(userId);
}
