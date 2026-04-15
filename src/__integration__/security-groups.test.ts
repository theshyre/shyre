import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "./helpers/prefix";
import { cleanupPrefix } from "./helpers/cleanup";
import { createTestUser } from "./helpers/users";
import { createTestTeam, addTeamMember } from "./helpers/teams";
import { createAuthedClient } from "./helpers/authed-client";
import { adminClient } from "./helpers/admin";

describe("security groups", () => {
  let prefix: string;

  beforeAll(() => {
    prefix = makeRunPrefix();
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("owner can create a group in their org", async () => {
    const owner = await createTestUser(prefix, "owner1");
    const org = await createTestTeam(prefix, owner.id, "org1");

    const client = await createAuthedClient(owner.email, owner.password);
    const { data, error } = await client
      .from("security_groups")
      .insert({
        team_id: org.id,
        name: `${prefix}group1`,
        created_by: owner.id,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("member cannot create a group", async () => {
    const owner = await createTestUser(prefix, "owner2");
    const member = await createTestUser(prefix, "member2");
    const org = await createTestTeam(prefix, owner.id, "org2");
    await addTeamMember(org.id, member.id, "member");

    const client = await createAuthedClient(member.email, member.password);
    const { error } = await client
      .from("security_groups")
      .insert({
        team_id: org.id,
        name: `${prefix}nope`,
        created_by: member.id,
      });

    expect(error).not.toBeNull();
  });

  it("non-member cannot create a group in another org", async () => {
    const ownerA = await createTestUser(prefix, "ownerA");
    const teamA = await createTestTeam(prefix, ownerA.id, "teamA");

    const outsider = await createTestUser(prefix, "outsider");

    const client = await createAuthedClient(outsider.email, outsider.password);
    const { error } = await client
      .from("security_groups")
      .insert({
        team_id: teamA.id,
        name: `${prefix}hack`,
        created_by: outsider.id,
      });

    expect(error).not.toBeNull();
  });

  it("trigger rejects adding non-member user to a group", async () => {
    const owner = await createTestUser(prefix, "ownerT");
    const stranger = await createTestUser(prefix, "stranger");
    const org = await createTestTeam(prefix, owner.id, "orgT");

    const admin = adminClient();
    const { data: group } = await admin
      .from("security_groups")
      .insert({
        team_id: org.id,
        name: `${prefix}gT`,
        created_by: owner.id,
      })
      .select("id")
      .single();

    const { error } = await admin
      .from("security_group_members")
      .insert({
        group_id: group!.id,
        user_id: stranger.id,
      });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/member of.*team/i);
  });

  it("owner can add and remove org members from a group", async () => {
    const owner = await createTestUser(prefix, "ownerAR");
    const member = await createTestUser(prefix, "memberAR");
    const org = await createTestTeam(prefix, owner.id, "orgAR");
    await addTeamMember(org.id, member.id, "member");

    const ownerClient = await createAuthedClient(owner.email, owner.password);
    const { data: group } = await ownerClient
      .from("security_groups")
      .insert({
        team_id: org.id,
        name: `${prefix}gAR`,
        created_by: owner.id,
      })
      .select("id")
      .single();

    const { error: addErr } = await ownerClient
      .from("security_group_members")
      .insert({ group_id: group!.id, user_id: member.id });
    expect(addErr).toBeNull();

    const { error: rmErr } = await ownerClient
      .from("security_group_members")
      .delete()
      .eq("group_id", group!.id)
      .eq("user_id", member.id);
    expect(rmErr).toBeNull();
  });

  it("deleting a group cascades members", async () => {
    const owner = await createTestUser(prefix, "ownerC");
    const member = await createTestUser(prefix, "memberC");
    const org = await createTestTeam(prefix, owner.id, "orgC");
    await addTeamMember(org.id, member.id, "member");

    const admin = adminClient();
    const { data: group } = await admin
      .from("security_groups")
      .insert({
        team_id: org.id,
        name: `${prefix}gC`,
        created_by: owner.id,
      })
      .select("id")
      .single();

    await admin
      .from("security_group_members")
      .insert({ group_id: group!.id, user_id: member.id });

    // Verify member exists
    const { data: beforeDelete } = await admin
      .from("security_group_members")
      .select("group_id")
      .eq("group_id", group!.id);
    expect(beforeDelete).toHaveLength(1);

    // Delete group
    await admin.from("security_groups").delete().eq("id", group!.id);

    // Member should be cascaded
    const { data: afterDelete } = await admin
      .from("security_group_members")
      .select("group_id")
      .eq("group_id", group!.id);
    expect(afterDelete).toHaveLength(0);
  });
});
