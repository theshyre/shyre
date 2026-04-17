import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import { createTestUser, TestUser } from "../helpers/users";
import { createTestTeam, addTeamMember, TestTeam } from "../helpers/teams";

// Phase 2d — meta-permission. can_set_rate_permissions gates WHO may
// change rate_visibility / rate_editability values on any object.
// Owner always qualifies; admins only qualify when team_settings.
// admins_can_set_rate_permissions = true.

describe("Phase 2d: can_set_rate_permissions + delegation flag", () => {
  let prefix: string;
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let team: TestTeam;

  let ownerClient: SupabaseClient;
  let adminClientAuthed: SupabaseClient;
  let memberClient: SupabaseClient;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    owner = await createTestUser(prefix, "owner");
    admin = await createTestUser(prefix, "admin");
    member = await createTestUser(prefix, "member");

    team = await createTestTeam(prefix, owner.id, "deleg");
    await addTeamMember(team.id, admin.id, "admin");
    await addTeamMember(team.id, member.id, "member");

    ownerClient = await createAuthedClient(owner.email, owner.password);
    adminClientAuthed = await createAuthedClient(admin.email, admin.password);
    memberClient = await createAuthedClient(member.email, member.password);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  async function setDelegation(enabled: boolean): Promise<void> {
    const { error } = await adminClient()
      .from("team_settings")
      .update({ admins_can_set_rate_permissions: enabled })
      .eq("team_id", team.id);
    if (error) throw new Error(`setDelegation: ${error.message}`);
  }

  async function canSetPerms(client: SupabaseClient): Promise<boolean> {
    const { data, error } = await client.rpc("can_set_rate_permissions", {
      p_team_id: team.id,
    });
    if (error) throw new Error(`rpc error: ${error.message}`);
    return Boolean(data);
  }

  it("default (delegation=false): only owner qualifies", async () => {
    await setDelegation(false);
    expect(await canSetPerms(ownerClient)).toBe(true);
    expect(await canSetPerms(adminClientAuthed)).toBe(false);
    expect(await canSetPerms(memberClient)).toBe(false);
  });

  it("delegation=true: admin also qualifies; member still does not", async () => {
    await setDelegation(true);
    expect(await canSetPerms(ownerClient)).toBe(true);
    expect(await canSetPerms(adminClientAuthed)).toBe(true);
    expect(await canSetPerms(memberClient)).toBe(false);
  });

  it("revoking delegation flips admin back to unauthorized", async () => {
    await setDelegation(true);
    expect(await canSetPerms(adminClientAuthed)).toBe(true);
    await setDelegation(false);
    expect(await canSetPerms(adminClientAuthed)).toBe(false);
  });
});
