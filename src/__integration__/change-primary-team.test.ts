import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "./helpers/prefix";
import { cleanupPrefix } from "./helpers/cleanup";
import { createAuthedClient } from "./helpers/authed-client";
import { adminClient } from "./helpers/admin";
import { createTestUser } from "./helpers/users";
import { createTestTeam, addTeamMember } from "./helpers/teams";
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
    const teamA = await createTestTeam(prefix, alice.id, "orgA1");
    const teamB = await createTestTeam(prefix, alice.id, "orgB1");
    // Alice also in teamB as owner via createTestTeam

    const client = await createTestCustomer(prefix, teamA.id, alice.id, "client1");
    const project = await createTestProject(
      prefix,
      teamA.id,
      client.id,
      alice.id,
      "proj1",
    );

    const aliceClient = await createAuthedClient(alice.email, alice.password);

    const { error } = await aliceClient.rpc("change_customer_primary_team", {
      p_customer_id: client.id,
      p_new_team_id: teamB.id,
    });
    expect(error).toBeNull();

    const admin = adminClient();

    const { data: clientRow } = await admin
      .from("customers")
      .select("team_id")
      .eq("id", client.id)
      .single();
    expect(clientRow?.team_id).toBe(teamB.id);

    const { data: projectRow } = await admin
      .from("projects")
      .select("team_id")
      .eq("id", project.id)
      .single();
    expect(projectRow?.team_id).toBe(teamB.id);

    const { data: shares } = await admin
      .from("customer_shares")
      .select("team_id")
      .eq("customer_id", client.id);
    const teamIds = (shares ?? []).map((r) => r.team_id);
    expect(teamIds).toContain(teamA.id);
    expect(teamIds).not.toContain(teamB.id);
  });

  it("non-owner member cannot transfer the client", async () => {
    const alice = await createTestUser(prefix, "alice2");
    const carol = await createTestUser(prefix, "carol2");
    const teamA = await createTestTeam(prefix, alice.id, "orgA2");
    const teamB = await createTestTeam(prefix, alice.id, "orgB2");
    await addTeamMember(teamA.id, carol.id, "member");
    await addTeamMember(teamB.id, carol.id, "member");

    const client = await createTestCustomer(prefix, teamA.id, alice.id, "client2");

    const carolClient = await createAuthedClient(carol.email, carol.password);
    const { error } = await carolClient.rpc("change_customer_primary_team", {
      p_customer_id: client.id,
      p_new_team_id: teamB.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/owner/i);

    const { data } = await adminClient()
      .from("customers")
      .select("team_id")
      .eq("id", client.id)
      .single();
    expect(data?.team_id).toBe(teamA.id);
  });

  it("cannot transfer to an org the caller is not a member of", async () => {
    const alice = await createTestUser(prefix, "alice3");
    const eve = await createTestUser(prefix, "eve3");
    const teamA = await createTestTeam(prefix, alice.id, "orgA3");
    const teamOut = await createTestTeam(prefix, eve.id, "outsider3");

    const client = await createTestCustomer(prefix, teamA.id, alice.id, "client3");

    const aliceClient = await createAuthedClient(alice.email, alice.password);
    const { error } = await aliceClient.rpc("change_customer_primary_team", {
      p_customer_id: client.id,
      p_new_team_id: teamOut.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/member/i);

    const { data } = await adminClient()
      .from("customers")
      .select("team_id")
      .eq("id", client.id)
      .single();
    expect(data?.team_id).toBe(teamA.id);
  });

  it("projects' team_id is updated to the new primary", async () => {
    const alice = await createTestUser(prefix, "alice4");
    const teamA = await createTestTeam(prefix, alice.id, "orgA4");
    const teamB = await createTestTeam(prefix, alice.id, "orgB4");

    const client = await createTestCustomer(prefix, teamA.id, alice.id, "client4");
    const projectA = await createTestProject(
      prefix,
      teamA.id,
      client.id,
      alice.id,
      "projA4",
    );
    const projectB = await createTestProject(
      prefix,
      teamA.id,
      client.id,
      alice.id,
      "projB4",
    );

    const aliceClient = await createAuthedClient(alice.email, alice.password);
    const { error } = await aliceClient.rpc("change_customer_primary_team", {
      p_customer_id: client.id,
      p_new_team_id: teamB.id,
    });
    expect(error).toBeNull();

    const admin = adminClient();
    const { data: rows } = await admin
      .from("projects")
      .select("id, team_id")
      .in("id", [projectA.id, projectB.id]);

    expect(rows).toHaveLength(2);
    for (const r of rows!) {
      expect(r.team_id).toBe(teamB.id);
    }
  });
});
