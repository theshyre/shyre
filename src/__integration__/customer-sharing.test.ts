import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "./helpers/prefix";
import { cleanupPrefix } from "./helpers/cleanup";
import { createAuthedClient } from "./helpers/authed-client";
import { adminClient } from "./helpers/admin";
import { twoOrgSharingScenario, TwoOrgSharingScenario } from "./helpers/fixtures";

describe("client sharing", () => {
  let prefix: string;
  let scenario: TwoOrgSharingScenario;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoOrgSharingScenario(prefix);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("primary org owner can add a participating org as a share", async () => {
    const alice = await createAuthedClient(scenario.alice.email, scenario.alice.password);

    const { data, error } = await alice.rpc("add_customer_share", {
      p_customer_id: scenario.client.id,
      p_org_id: scenario.participatingOrg.id,
      p_can_see_others: false,
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    // Verify row exists
    const { data: shares } = await adminClient()
      .from("customer_shares")
      .select("id, organization_id, can_see_others_entries")
      .eq("customer_id", scenario.client.id)
      .eq("organization_id", scenario.participatingOrg.id);

    expect(shares).toHaveLength(1);
    expect(shares?.[0]?.can_see_others_entries).toBe(false);
  });

  it("cannot share with the client's primary org", async () => {
    const alice = await createAuthedClient(scenario.alice.email, scenario.alice.password);

    const { error } = await alice.rpc("add_customer_share", {
      p_customer_id: scenario.client.id,
      p_org_id: scenario.primaryOrg.id,
      p_can_see_others: false,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/primary organization/i);
  });

  it("primary org member (not admin) cannot add a share", async () => {
    const carol = await createAuthedClient(scenario.carol.email, scenario.carol.password);

    const { error } = await carol.rpc("add_customer_share", {
      p_customer_id: scenario.client.id,
      p_org_id: scenario.outsiderOrg.id,
      p_can_see_others: false,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/admin/i);
  });

  it("client admin can toggle can_see_others_entries on an existing share", async () => {
    // Ensure a share row exists
    const admin = adminClient();
    await admin
      .from("customer_shares")
      .upsert(
        {
          customer_id: scenario.client.id,
          organization_id: scenario.participatingOrg.id,
          can_see_others_entries: false,
          created_by: scenario.alice.id,
        },
        { onConflict: "customer_id,organization_id" },
      );

    const alice = await createAuthedClient(scenario.alice.email, scenario.alice.password);

    const { error } = await alice
      .from("customer_shares")
      .update({ can_see_others_entries: true })
      .eq("customer_id", scenario.client.id)
      .eq("organization_id", scenario.participatingOrg.id);

    expect(error).toBeNull();

    const { data: rows } = await admin
      .from("customer_shares")
      .select("can_see_others_entries")
      .eq("customer_id", scenario.client.id)
      .eq("organization_id", scenario.participatingOrg.id)
      .single();

    expect(rows?.can_see_others_entries).toBe(true);
  });

  it("client admin can remove a share via DELETE", async () => {
    const admin = adminClient();
    await admin
      .from("customer_shares")
      .upsert(
        {
          customer_id: scenario.client.id,
          organization_id: scenario.participatingOrg.id,
          can_see_others_entries: false,
          created_by: scenario.alice.id,
        },
        { onConflict: "customer_id,organization_id" },
      );

    const alice = await createAuthedClient(scenario.alice.email, scenario.alice.password);

    const { error } = await alice
      .from("customer_shares")
      .delete()
      .eq("customer_id", scenario.client.id)
      .eq("organization_id", scenario.participatingOrg.id);

    expect(error).toBeNull();

    const { data: rows } = await admin
      .from("customer_shares")
      .select("id")
      .eq("customer_id", scenario.client.id)
      .eq("organization_id", scenario.participatingOrg.id);

    expect(rows).toHaveLength(0);
  });
});
