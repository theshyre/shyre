import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoTeamSharingScenario,
  TwoTeamSharingScenario,
} from "../helpers/fixtures";

describe("customers RLS", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  async function resetSharing() {
    const admin = adminClient();
    await admin
      .from("customer_shares")
      .delete()
      .eq("customer_id", scenario.client.id);
    await admin
      .from("customer_permissions")
      .delete()
      .eq("customer_id", scenario.client.id);
  }

  it("primary org member can SELECT the client", async () => {
    await resetSharing();
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("customers")
      .select("id")
      .eq("id", scenario.client.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("outsider with no share or permission cannot SELECT the client", async () => {
    await resetSharing();
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data, error } = await eve
      .from("customers")
      .select("id")
      .eq("id", scenario.client.id);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("after a client_share for participatingTeam, its members can SELECT the client", async () => {
    await resetSharing();
    const admin = adminClient();
    await admin.from("customer_shares").insert({
      customer_id: scenario.client.id,
      team_id: scenario.participatingTeam.id,
      can_see_others_entries: false,
      created_by: scenario.alice.id,
    });

    const bob = await createAuthedClient(
      scenario.bob.email,
      scenario.bob.password,
    );
    const { data: bobRows } = await bob
      .from("customers")
      .select("id")
      .eq("id", scenario.client.id);
    expect(bobRows).toHaveLength(1);

    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    const { data: daveRows } = await dave
      .from("customers")
      .select("id")
      .eq("id", scenario.client.id);
    expect(daveRows).toHaveLength(1);
  });

  it("direct viewer permission lets Eve SELECT but not UPDATE", async () => {
    await resetSharing();
    const admin = adminClient();
    await admin.from("customer_permissions").insert({
      customer_id: scenario.client.id,
      principal_type: "user",
      principal_id: scenario.eve.id,
      permission_level: "viewer",
      granted_by: scenario.alice.id,
    });

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );

    const { data: rows } = await eve
      .from("customers")
      .select("id, name")
      .eq("id", scenario.client.id);
    expect(rows).toHaveLength(1);

    const { data: beforeRow } = await admin
      .from("customers")
      .select("name")
      .eq("id", scenario.client.id)
      .single();

    await eve
      .from("customers")
      .update({ name: `${prefix}eve-viewer-update` })
      .eq("id", scenario.client.id);

    const { data: afterRow } = await admin
      .from("customers")
      .select("name")
      .eq("id", scenario.client.id)
      .single();
    expect(afterRow?.name).toBe(beforeRow?.name);
  });
});
