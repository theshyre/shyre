import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "./helpers/prefix";
import { cleanupPrefix } from "./helpers/cleanup";
import { createAuthedClient } from "./helpers/authed-client";
import { adminClient } from "./helpers/admin";
import { createTestUser } from "./helpers/users";
import { createTestTeam } from "./helpers/teams";

describe("team relationships (parent/child shares)", () => {
  let prefix: string;

  beforeAll(() => {
    prefix = makeRunPrefix();
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("owner can propose a parent->child share (creates pending row)", async () => {
    const user = await createTestUser(prefix, "u1");
    const parent = await createTestTeam(prefix, user.id, "parent1");
    const child = await createTestTeam(prefix, user.id, "child1");

    const client = await createAuthedClient(user.email, user.password);

    const { data: shareId, error } = await client.rpc(
      "propose_team_share",
      {
        p_parent_team_id: parent.id,
        p_child_team_id: child.id,
        p_sharing_level: "clients_read",
      },
    );

    expect(error).toBeNull();
    expect(shareId).toBeTruthy();

    const { data: row } = await adminClient()
      .from("team_shares")
      .select("id, parent_team_id, child_team_id, accepted_at, sharing_level")
      .eq("id", shareId)
      .single();

    expect(row?.parent_team_id).toBe(parent.id);
    expect(row?.child_team_id).toBe(child.id);
    expect(row?.accepted_at).toBeNull();
    expect(row?.sharing_level).toBe("clients_read");
  });

  it("child-side owner can accept a proposed share", async () => {
    const user = await createTestUser(prefix, "u2");
    const parent = await createTestTeam(prefix, user.id, "parent2");
    const child = await createTestTeam(prefix, user.id, "child2");

    const client = await createAuthedClient(user.email, user.password);

    const { data: shareId } = await client.rpc("propose_team_share", {
      p_parent_team_id: parent.id,
      p_child_team_id: child.id,
      p_sharing_level: "clients_read",
    });

    const { error: acceptErr } = await client.rpc(
      "accept_team_share",
      { p_share_id: shareId },
    );
    expect(acceptErr).toBeNull();

    const { data: row } = await adminClient()
      .from("team_shares")
      .select("accepted_at")
      .eq("id", shareId)
      .single();

    expect(row?.accepted_at).not.toBeNull();
  });

  it("parent-side owner can DELETE an organization_share", async () => {
    const user = await createTestUser(prefix, "u3");
    const parent = await createTestTeam(prefix, user.id, "parent3");
    const child = await createTestTeam(prefix, user.id, "child3");

    const client = await createAuthedClient(user.email, user.password);
    const { data: shareId } = await client.rpc("propose_team_share", {
      p_parent_team_id: parent.id,
      p_child_team_id: child.id,
      p_sharing_level: "clients_read",
    });

    const { error: delErr } = await client
      .from("team_shares")
      .delete()
      .eq("id", shareId);
    expect(delErr).toBeNull();

    const { data: rows } = await adminClient()
      .from("team_shares")
      .select("id")
      .eq("id", shareId);
    expect(rows).toHaveLength(0);
  });

  it("self-share (parent==child) is rejected by CHECK constraint", async () => {
    const user = await createTestUser(prefix, "u4");
    const org = await createTestTeam(prefix, user.id, "solo4");

    const client = await createAuthedClient(user.email, user.password);
    const { error } = await client.rpc("propose_team_share", {
      p_parent_team_id: org.id,
      p_child_team_id: org.id,
      p_sharing_level: "clients_read",
    });

    expect(error).not.toBeNull();
  });
});
