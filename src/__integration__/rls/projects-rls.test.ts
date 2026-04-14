import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoOrgSharingScenario,
  TwoOrgSharingScenario,
} from "../helpers/fixtures";
import { createTestProject } from "../helpers/customers";

describe("projects RLS", () => {
  let prefix: string;
  let scenario: TwoOrgSharingScenario;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoOrgSharingScenario(prefix);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("internal org project (null customer_id) is visible to primary org members only", async () => {
    // Create internal project in primaryOrg (no client)
    const internal = await createTestProject(
      prefix,
      scenario.primaryOrg.id,
      null,
      scenario.alice.id,
      "internal",
    );

    // Share the scenario client with participatingOrg so Dave has a cross-org pathway
    // that should NOT grant him access to this internal project.
    const admin = adminClient();
    await admin.from("customer_shares").upsert(
      {
        customer_id: scenario.client.id,
        organization_id: scenario.participatingOrg.id,
        can_see_others_entries: false,
        created_by: scenario.alice.id,
      },
      { onConflict: "customer_id,organization_id" },
    );

    // Primary member Carol can see it
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data: carolRows } = await carol
      .from("projects")
      .select("id")
      .eq("id", internal.id);
    expect(carolRows).toHaveLength(1);

    // Dave (participating, not primary) cannot see it
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    const { data: daveRows } = await dave
      .from("projects")
      .select("id")
      .eq("id", internal.id);
    expect(daveRows ?? []).toHaveLength(0);
  });

  it("project with customer_id follows the client's visibility rules", async () => {
    // Ensure share exists
    const admin = adminClient();
    await admin.from("customer_shares").upsert(
      {
        customer_id: scenario.client.id,
        organization_id: scenario.participatingOrg.id,
        can_see_others_entries: false,
        created_by: scenario.alice.id,
      },
      { onConflict: "customer_id,organization_id" },
    );

    // Dave (participating member) CAN see the scenario project (client-linked)
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    const { data: daveRows } = await dave
      .from("projects")
      .select("id")
      .eq("id", scenario.project.id);
    expect(daveRows).toHaveLength(1);

    // Eve (outsider, no share, no permission) cannot see it
    // Clear any lingering permission row for Eve
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
    const { data: eveRows } = await eve
      .from("projects")
      .select("id")
      .eq("id", scenario.project.id);
    expect(eveRows ?? []).toHaveLength(0);
  });

  it("non-admin participating user cannot INSERT a project on a shared client", async () => {
    const admin = adminClient();
    await admin.from("customer_shares").upsert(
      {
        customer_id: scenario.client.id,
        organization_id: scenario.participatingOrg.id,
        can_see_others_entries: false,
        created_by: scenario.alice.id,
      },
      { onConflict: "customer_id,organization_id" },
    );

    // Dave is a regular member of participatingOrg — not a client admin.
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );

    const { error } = await dave
      .from("projects")
      .insert({
        organization_id: scenario.participatingOrg.id,
        user_id: scenario.dave.id,
        customer_id: scenario.client.id,
        name: `${prefix}dave-attempt`,
        status: "active",
      });

    expect(error).not.toBeNull();
  });
});
