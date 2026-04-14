import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoOrgSharingScenario,
  TwoOrgSharingScenario,
} from "../helpers/fixtures";

/**
 * RLS for time_templates: each user only sees/modifies their own, and only
 * within orgs they belong to.
 */
describe("time_templates RLS", () => {
  let prefix: string;
  let scenario: TwoOrgSharingScenario;
  let aliceTplId: string;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoOrgSharingScenario(prefix);

    const admin = adminClient();
    const { data, error } = await admin
      .from("time_templates")
      .insert({
        organization_id: scenario.primaryOrg.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        name: `${prefix}alice-tpl`,
        description: "alice's standup",
        billable: true,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`setup: ${error?.message}`);
    aliceTplId = data.id;
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("Alice can SELECT her own template", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("time_templates")
      .select("id, name")
      .eq("id", aliceTplId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Carol (same org) CANNOT SELECT Alice's template", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data } = await carol
      .from("time_templates")
      .select("id")
      .eq("id", aliceTplId);
    expect(data ?? []).toHaveLength(0);
  });

  it("Eve (outsider) CANNOT SELECT Alice's template", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data } = await eve
      .from("time_templates")
      .select("id")
      .eq("id", aliceTplId);
    expect(data ?? []).toHaveLength(0);
  });

  it("Carol CANNOT INSERT a template into Alice's user_id", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { error } = await carol
      .from("time_templates")
      .insert({
        organization_id: scenario.primaryOrg.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        name: `${prefix}carol-spoof`,
      })
      .select("id")
      .single();
    expect(error).toBeTruthy();
  });

  it("Carol CANNOT UPDATE Alice's template", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    await carol
      .from("time_templates")
      .update({ name: "hijacked" })
      .eq("id", aliceTplId);
    const admin = adminClient();
    const { data: after } = await admin
      .from("time_templates")
      .select("name")
      .eq("id", aliceTplId)
      .single();
    expect(after?.name).toContain("alice-tpl");
  });

  it("Carol CANNOT DELETE Alice's template", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    await carol.from("time_templates").delete().eq("id", aliceTplId);
    const admin = adminClient();
    const { data } = await admin
      .from("time_templates")
      .select("id")
      .eq("id", aliceTplId);
    expect(data ?? []).toHaveLength(1);
  });

  it("Alice can INSERT a template for herself", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("time_templates")
      .insert({
        organization_id: scenario.primaryOrg.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        name: `${prefix}alice-second`,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data).toBeTruthy();

    if (data?.id) {
      await adminClient().from("time_templates").delete().eq("id", data.id);
    }
  });
});
