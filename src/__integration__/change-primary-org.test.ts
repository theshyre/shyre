import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "./helpers/prefix";
import { cleanupPrefix } from "./helpers/cleanup";
import { createAuthedClient } from "./helpers/authed-client";
import { adminClient } from "./helpers/admin";
import { createTestUser } from "./helpers/users";
import { createTestOrg, addOrgMember } from "./helpers/orgs";
import { createTestCustomer, createTestProject } from "./helpers/customers";

describe("change_client_primary_org RPC", () => {
  let prefix: string;

  beforeAll(() => {
    prefix = makeRunPrefix();
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("owner-of-both can transfer client to a second org and old primary becomes participant", async () => {
    const alice = await createTestUser(prefix, "alice1");
    const orgA = await createTestOrg(prefix, alice.id, "orgA1");
    const orgB = await createTestOrg(prefix, alice.id, "orgB1");
    // Alice also in orgB as owner via createTestOrg

    const client = await createTestCustomer(prefix, orgA.id, alice.id, "client1");
    const project = await createTestProject(
      prefix,
      orgA.id,
      client.id,
      alice.id,
      "proj1",
    );

    const aliceClient = await createAuthedClient(alice.email, alice.password);

    const { error } = await aliceClient.rpc("change_customer_primary_org", {
      p_customer_id: client.id,
      p_new_org_id: orgB.id,
    });
    expect(error).toBeNull();

    const admin = adminClient();

    const { data: clientRow } = await admin
      .from("customers")
      .select("organization_id")
      .eq("id", client.id)
      .single();
    expect(clientRow?.organization_id).toBe(orgB.id);

    const { data: projectRow } = await admin
      .from("projects")
      .select("organization_id")
      .eq("id", project.id)
      .single();
    expect(projectRow?.organization_id).toBe(orgB.id);

    const { data: shares } = await admin
      .from("customer_shares")
      .select("organization_id")
      .eq("customer_id", client.id);
    const orgIds = (shares ?? []).map((r) => r.organization_id);
    expect(orgIds).toContain(orgA.id);
    expect(orgIds).not.toContain(orgB.id);
  });

  it("non-owner member cannot transfer the client", async () => {
    const alice = await createTestUser(prefix, "alice2");
    const carol = await createTestUser(prefix, "carol2");
    const orgA = await createTestOrg(prefix, alice.id, "orgA2");
    const orgB = await createTestOrg(prefix, alice.id, "orgB2");
    await addOrgMember(orgA.id, carol.id, "member");
    await addOrgMember(orgB.id, carol.id, "member");

    const client = await createTestCustomer(prefix, orgA.id, alice.id, "client2");

    const carolClient = await createAuthedClient(carol.email, carol.password);
    const { error } = await carolClient.rpc("change_customer_primary_org", {
      p_customer_id: client.id,
      p_new_org_id: orgB.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/owner/i);

    const { data } = await adminClient()
      .from("customers")
      .select("organization_id")
      .eq("id", client.id)
      .single();
    expect(data?.organization_id).toBe(orgA.id);
  });

  it("cannot transfer to an org the caller is not a member of", async () => {
    const alice = await createTestUser(prefix, "alice3");
    const eve = await createTestUser(prefix, "eve3");
    const orgA = await createTestOrg(prefix, alice.id, "orgA3");
    const orgOut = await createTestOrg(prefix, eve.id, "outsider3");

    const client = await createTestCustomer(prefix, orgA.id, alice.id, "client3");

    const aliceClient = await createAuthedClient(alice.email, alice.password);
    const { error } = await aliceClient.rpc("change_customer_primary_org", {
      p_customer_id: client.id,
      p_new_org_id: orgOut.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/member/i);

    const { data } = await adminClient()
      .from("customers")
      .select("organization_id")
      .eq("id", client.id)
      .single();
    expect(data?.organization_id).toBe(orgA.id);
  });

  it("projects' organization_id is updated to the new primary", async () => {
    const alice = await createTestUser(prefix, "alice4");
    const orgA = await createTestOrg(prefix, alice.id, "orgA4");
    const orgB = await createTestOrg(prefix, alice.id, "orgB4");

    const client = await createTestCustomer(prefix, orgA.id, alice.id, "client4");
    const projectA = await createTestProject(
      prefix,
      orgA.id,
      client.id,
      alice.id,
      "projA4",
    );
    const projectB = await createTestProject(
      prefix,
      orgA.id,
      client.id,
      alice.id,
      "projB4",
    );

    const aliceClient = await createAuthedClient(alice.email, alice.password);
    const { error } = await aliceClient.rpc("change_customer_primary_org", {
      p_customer_id: client.id,
      p_new_org_id: orgB.id,
    });
    expect(error).toBeNull();

    const admin = adminClient();
    const { data: rows } = await admin
      .from("projects")
      .select("id, organization_id")
      .in("id", [projectA.id, projectB.id]);

    expect(rows).toHaveLength(2);
    for (const r of rows!) {
      expect(r.organization_id).toBe(orgB.id);
    }
  });
});
