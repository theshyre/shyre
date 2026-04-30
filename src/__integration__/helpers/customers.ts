import { adminClient } from "./admin";
import { assertTestPrefix } from "./prefix";

export interface TestClient {
  id: string;
  name: string;
  teamId: string;
}

export async function createTestCustomer(
  prefix: string,
  teamId: string,
  userId: string,
  label = "client",
): Promise<TestClient> {
  assertTestPrefix(prefix, "prefix");
  const name = `${prefix}${label}`;

  const { data, error } = await adminClient()
    .from("customers")
    .insert({
      team_id: teamId,
      user_id: userId,
      name,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create client: ${error?.message}`);
  return { id: data.id, name, teamId };
}

export async function createTestProject(
  prefix: string,
  teamId: string,
  customerId: string | null,
  userId: string,
  label = "project",
): Promise<{ id: string; name: string }> {
  assertTestPrefix(prefix, "prefix");
  const name = `${prefix}${label}`;

  const { data, error } = await adminClient()
    .from("projects")
    .insert({
      team_id: teamId,
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
  teamId: string,
  projectId: string,
  userId: string,
  overrides?: {
    description?: string;
    hoursAgo?: number;
    /** Explicit start_time. Wins over hoursAgo. */
    startTime?: Date;
    /** Explicit end_time. Defaults to start + 1h when startTime is set. */
    endTime?: Date;
    durationMin?: number;
    billable?: boolean;
  },
): Promise<{ id: string }> {
  assertTestPrefix(prefix, "prefix");
  const description = `${prefix}${overrides?.description ?? "time entry"}`;

  let start: Date;
  let end: Date;
  if (overrides?.startTime) {
    start = overrides.startTime;
    end = overrides.endTime ?? new Date(start.getTime() + 60 * 60 * 1000);
  } else {
    const hoursAgo = overrides?.hoursAgo ?? 2;
    end = new Date();
    start = new Date(end.getTime() - hoursAgo * 60 * 60 * 1000);
  }
  // Note: duration_min is a GENERATED ALWAYS column — set start/end and
  // let Postgres compute it.

  const { data, error } = await adminClient()
    .from("time_entries")
    .insert({
      team_id: teamId,
      user_id: userId,
      project_id: projectId,
      description,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      billable: overrides?.billable ?? true,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create time entry: ${error?.message}`);
  return { id: data.id };
}

export async function createTestSecurityGroup(
  prefix: string,
  teamId: string,
  userId: string,
  label = "group",
): Promise<{ id: string; name: string }> {
  assertTestPrefix(prefix, "prefix");
  const name = `${prefix}${label}`;

  const { data, error } = await adminClient()
    .from("security_groups")
    .insert({
      team_id: teamId,
      name,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create group: ${error?.message}`);
  return { id: data.id, name };
}
