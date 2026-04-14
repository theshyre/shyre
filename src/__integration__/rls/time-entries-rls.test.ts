import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoOrgSharingScenario,
  TwoOrgSharingScenario,
} from "../helpers/fixtures";
import { createTestTimeEntry } from "../helpers/customers";

describe("time_entries RLS (cross-org sharing)", () => {
  let prefix: string;
  let scenario: TwoOrgSharingScenario;
  let daveEntryId: string;
  let aliceEntryId: string;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoOrgSharingScenario(prefix);

    // Share the client with participatingOrg, initially without can_see_others_entries
    const admin = adminClient();
    await admin.from("customer_shares").insert({
      customer_id: scenario.client.id,
      organization_id: scenario.participatingOrg.id,
      can_see_others_entries: false,
      created_by: scenario.alice.id,
    });

    // Seed Alice's time entry (primary org user) directly via admin helper
    const aliceEntry = await createTestTimeEntry(
      prefix,
      scenario.primaryOrg.id,
      scenario.project.id,
      scenario.alice.id,
      { description: "alice-entry" },
    );
    aliceEntryId = aliceEntry.id;
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("participating user (Dave) can INSERT a time_entry on the shared project", async () => {
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );

    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);

    const { data, error } = await dave
      .from("time_entries")
      .insert({
        organization_id: scenario.participatingOrg.id,
        user_id: scenario.dave.id,
        project_id: scenario.project.id,
        description: `${prefix}dave-entry`,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        billable: true,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    daveEntryId = data!.id;
  });

  it("Alice (primary org) can SELECT Dave's cross-org entry", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("time_entries")
      .select("id")
      .eq("id", daveEntryId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Bob (same participating org as Dave) can SELECT Dave's entry", async () => {
    const bob = await createAuthedClient(
      scenario.bob.email,
      scenario.bob.password,
    );
    const { data, error } = await bob
      .from("time_entries")
      .select("id")
      .eq("id", daveEntryId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Dave CANNOT SELECT Alice's entry when can_see_others_entries=false", async () => {
    // Ensure the flag is false
    const admin = adminClient();
    await admin
      .from("customer_shares")
      .update({ can_see_others_entries: false })
      .eq("customer_id", scenario.client.id)
      .eq("organization_id", scenario.participatingOrg.id);

    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    const { data, error } = await dave
      .from("time_entries")
      .select("id")
      .eq("id", aliceEntryId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("toggling can_see_others_entries=true grants Dave visibility on Alice's entry", async () => {
    const admin = adminClient();
    await admin
      .from("customer_shares")
      .update({ can_see_others_entries: true })
      .eq("customer_id", scenario.client.id)
      .eq("organization_id", scenario.participatingOrg.id);

    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    const { data, error } = await dave
      .from("time_entries")
      .select("id")
      .eq("id", aliceEntryId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Eve (outsider, no share) cannot SELECT any entries on the client's project", async () => {
    // Make sure Eve has no lingering permission row
    const admin = adminClient();
    await admin
      .from("customer_permissions")
      .delete()
      .eq("customer_id", scenario.client.id)
      .eq("principal_type", "user")
      .eq("principal_id", scenario.eve.id);

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data, error } = await eve
      .from("time_entries")
      .select("id")
      .in("id", [aliceEntryId, daveEntryId]);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
