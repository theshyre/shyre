import { beforeAll, afterAll, describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import { createTestUser, TestUser } from "../helpers/users";
import { createTestTeam, addTeamMember, TestTeam } from "../helpers/teams";
import {
  createTestCustomer,
  createTestProject,
  TestClient,
} from "../helpers/customers";

// Phase 2c — rate editability. Mirrors rate-visibility.test.ts but
// exercises the can_set_X helpers against the rate_editability column.

describe("Phase 2c: rate editability helpers", () => {
  let prefix: string;
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let team: TestTeam;
  let memberMembershipId: string;
  let customer: TestClient;
  let project: { id: string; name: string };

  let ownerClient: SupabaseClient;
  let adminClientAuthed: SupabaseClient;
  let memberClient: SupabaseClient;
  let outsiderClient: SupabaseClient;

  beforeAll(async () => {
    prefix = makeRunPrefix();

    owner = await createTestUser(prefix, "owner");
    admin = await createTestUser(prefix, "admin");
    member = await createTestUser(prefix, "member");
    outsider = await createTestUser(prefix, "outsider");

    team = await createTestTeam(prefix, owner.id, "rateedit");
    await addTeamMember(team.id, admin.id, "admin");
    await addTeamMember(team.id, member.id, "member");

    customer = await createTestCustomer(prefix, team.id, owner.id);
    project = await createTestProject(prefix, team.id, customer.id, owner.id);

    const { data: mm } = await adminClient()
      .from("team_members")
      .select("id")
      .eq("team_id", team.id)
      .eq("user_id", member.id)
      .single();
    if (!mm?.id) throw new Error("failed to locate member's team_members row");
    memberMembershipId = mm.id;

    ownerClient = await createAuthedClient(owner.email, owner.password);
    adminClientAuthed = await createAuthedClient(admin.email, admin.password);
    memberClient = await createAuthedClient(member.email, member.password);
    outsiderClient = await createAuthedClient(outsider.email, outsider.password);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  async function setRateEditability(
    table: "team_settings" | "projects" | "customers" | "team_members",
    where: Record<string, string>,
    level: "owner" | "admins" | "self" | "all_members",
  ): Promise<void> {
    const q = adminClient().from(table).update({ rate_editability: level });
    for (const [k, v] of Object.entries(where)) q.eq(k, v);
    const { error } = await q;
    if (error) throw new Error(`setRateEditability ${table}: ${error.message}`);
  }

  async function canSet(
    client: SupabaseClient,
    rpc:
      | "can_set_team_rate"
      | "can_set_project_rate"
      | "can_set_customer_rate"
      | "can_set_member_rate",
    arg: Record<string, string>,
  ): Promise<boolean> {
    const { data, error } = await client.rpc(rpc, arg);
    if (error) throw new Error(`${rpc} rpc: ${error.message}`);
    return Boolean(data);
  }

  describe("can_set_team_rate", () => {
    it("default 'owner': only owner can set", async () => {
      await setRateEditability("team_settings", { team_id: team.id }, "owner");
      expect(await canSet(ownerClient, "can_set_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canSet(adminClientAuthed, "can_set_team_rate", { p_team_id: team.id })).toBe(false);
      expect(await canSet(memberClient, "can_set_team_rate", { p_team_id: team.id })).toBe(false);
    });

    it("'admins': owner + admin can set, member cannot", async () => {
      await setRateEditability("team_settings", { team_id: team.id }, "admins");
      expect(await canSet(adminClientAuthed, "can_set_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canSet(memberClient, "can_set_team_rate", { p_team_id: team.id })).toBe(false);
    });

    it("'all_members': every member can set", async () => {
      await setRateEditability("team_settings", { team_id: team.id }, "all_members");
      expect(await canSet(memberClient, "can_set_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canSet(outsiderClient, "can_set_team_rate", { p_team_id: team.id })).toBe(false);
    });
  });

  describe("can_set_project_rate", () => {
    it("default 'owner': only owner", async () => {
      await setRateEditability("projects", { id: project.id }, "owner");
      expect(await canSet(ownerClient, "can_set_project_rate", { p_project_id: project.id })).toBe(true);
      expect(await canSet(adminClientAuthed, "can_set_project_rate", { p_project_id: project.id })).toBe(false);
    });

    it("'admins': admin can set", async () => {
      await setRateEditability("projects", { id: project.id }, "admins");
      expect(await canSet(adminClientAuthed, "can_set_project_rate", { p_project_id: project.id })).toBe(true);
      expect(await canSet(memberClient, "can_set_project_rate", { p_project_id: project.id })).toBe(false);
    });

    it("'all_members': member can set", async () => {
      await setRateEditability("projects", { id: project.id }, "all_members");
      expect(await canSet(memberClient, "can_set_project_rate", { p_project_id: project.id })).toBe(true);
    });

    it("cross-team customer admin can set regardless of team's rate_editability", async () => {
      await setRateEditability("projects", { id: project.id }, "owner");
      await adminClient().from("customer_permissions").insert({
        customer_id: customer.id,
        principal_type: "user",
        principal_id: outsider.id,
        permission_level: "admin",
        granted_by: owner.id,
      });
      expect(await canSet(outsiderClient, "can_set_project_rate", { p_project_id: project.id })).toBe(true);
      // Same-team admin still blocked by 'owner' editability — cross-team
      // bypass narrows to users with no team role on this team.
      expect(await canSet(adminClientAuthed, "can_set_project_rate", { p_project_id: project.id })).toBe(false);
      await adminClient()
        .from("customer_permissions")
        .delete()
        .eq("customer_id", customer.id)
        .eq("principal_type", "user")
        .eq("principal_id", outsider.id);
    });
  });

  describe("can_set_customer_rate", () => {
    it("default 'owner': only owner", async () => {
      await setRateEditability("customers", { id: customer.id }, "owner");
      expect(await canSet(ownerClient, "can_set_customer_rate", { p_customer_id: customer.id })).toBe(true);
      expect(await canSet(adminClientAuthed, "can_set_customer_rate", { p_customer_id: customer.id })).toBe(false);
    });

    it("'admins': admin can set", async () => {
      await setRateEditability("customers", { id: customer.id }, "admins");
      expect(await canSet(adminClientAuthed, "can_set_customer_rate", { p_customer_id: customer.id })).toBe(true);
    });

    it("'all_members': member can set", async () => {
      await setRateEditability("customers", { id: customer.id }, "all_members");
      expect(await canSet(memberClient, "can_set_customer_rate", { p_customer_id: customer.id })).toBe(true);
    });
  });

  describe("can_set_member_rate (4-level including 'self')", () => {
    it("default 'owner': only owner can set (not even the member themselves)", async () => {
      await setRateEditability("team_members", { id: memberMembershipId }, "owner");
      expect(await canSet(ownerClient, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      expect(await canSet(adminClientAuthed, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
      expect(await canSet(memberClient, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
    });

    it("'admins': owner + admin can set; the member cannot set their own", async () => {
      await setRateEditability("team_members", { id: memberMembershipId }, "admins");
      expect(await canSet(adminClientAuthed, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      expect(await canSet(memberClient, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
    });

    it("'self': the specific member can set their own rate; other members still cannot", async () => {
      await setRateEditability("team_members", { id: memberMembershipId }, "self");
      expect(await canSet(memberClient, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      const otherMember = await createTestUser(prefix, "m2-edit");
      await addTeamMember(team.id, otherMember.id, "member");
      const otherMemberClient = await createAuthedClient(otherMember.email, otherMember.password);
      expect(await canSet(otherMemberClient, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
    });

    it("'all_members': every team member can set every member's rate", async () => {
      await setRateEditability("team_members", { id: memberMembershipId }, "all_members");
      expect(await canSet(memberClient, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      expect(await canSet(outsiderClient, "can_set_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
    });
  });
});
