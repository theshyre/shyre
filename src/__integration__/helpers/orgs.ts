import { adminClient } from "./admin";
import { assertTestPrefix } from "./prefix";

export interface TestOrg {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
}

export async function createTestOrg(
  prefix: string,
  ownerId: string,
  label = "org",
): Promise<TestOrg> {
  assertTestPrefix(prefix, "prefix");
  const name = `${prefix}${label}`;
  const slug = `${prefix}${label}-${Date.now().toString(36)}`;

  const admin = adminClient();

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name, slug, is_personal: false })
    .select("id")
    .single();

  if (orgErr || !org) {
    throw new Error(`Failed to create test org: ${orgErr?.message}`);
  }

  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: ownerId,
      role: "owner",
    });

  if (memberErr) {
    throw new Error(`Failed to add owner membership: ${memberErr.message}`);
  }

  const { error: settingsErr } = await admin
    .from("organization_settings")
    .insert({ organization_id: org.id });

  if (settingsErr) {
    throw new Error(`Failed to create org settings: ${settingsErr.message}`);
  }

  return { id: org.id, name, slug, ownerId };
}

export async function addOrgMember(
  orgId: string,
  userId: string,
  role: "owner" | "admin" | "member",
): Promise<void> {
  const { error } = await adminClient()
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: userId, role });
  if (error) throw new Error(error.message);
}

export async function removeOrgMember(
  orgId: string,
  userId: string,
): Promise<void> {
  const { error } = await adminClient()
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
