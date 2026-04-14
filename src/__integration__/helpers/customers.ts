import { adminClient } from "./admin";
import { assertTestPrefix } from "./prefix";

export interface TestClient {
  id: string;
  name: string;
  orgId: string;
}

export async function createTestCustomer(
  prefix: string,
  orgId: string,
  userId: string,
  label = "client",
): Promise<TestClient> {
  assertTestPrefix(prefix, "prefix");
  const name = `${prefix}${label}`;

  const { data, error } = await adminClient()
    .from("customers")
    .insert({
      organization_id: orgId,
      user_id: userId,
      name,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create client: ${error?.message}`);
  return { id: data.id, name, orgId };
}

export async function createTestProject(
  prefix: string,
  orgId: string,
  customerId: string | null,
  userId: string,
  label = "project",
): Promise<{ id: string; name: string }> {
  assertTestPrefix(prefix, "prefix");
  const name = `${prefix}${label}`;

  const { data, error } = await adminClient()
    .from("projects")
    .insert({
      organization_id: orgId,
      user_id: userId,
      customer_id: customerId,
      name,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create project: ${error?.message}`);
  return { id: data.id, name };
}

export async function createTestTimeEntry(
  prefix: string,
  orgId: string,
  projectId: string,
  userId: string,
  overrides?: { description?: string; hoursAgo?: number },
): Promise<{ id: string }> {
  assertTestPrefix(prefix, "prefix");
  const description = `${prefix}${overrides?.description ?? "time entry"}`;
  const hoursAgo = overrides?.hoursAgo ?? 2;
  const end = new Date();
  const start = new Date(end.getTime() - hoursAgo * 60 * 60 * 1000);

  const { data, error } = await adminClient()
    .from("time_entries")
    .insert({
      organization_id: orgId,
      user_id: userId,
      project_id: projectId,
      description,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      billable: true,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create time entry: ${error?.message}`);
  return { id: data.id };
}

export async function createTestSecurityGroup(
  prefix: string,
  orgId: string,
  userId: string,
  label = "group",
): Promise<{ id: string; name: string }> {
  assertTestPrefix(prefix, "prefix");
  const name = `${prefix}${label}`;

  const { data, error } = await adminClient()
    .from("security_groups")
    .insert({
      organization_id: orgId,
      name,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create group: ${error?.message}`);
  return { id: data.id, name };
}
