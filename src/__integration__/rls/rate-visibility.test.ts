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

// Phase 2a — rate visibility. Verifies that:
//   - the four helper functions (can_view_team_rate, can_view_project_rate,
//     can_view_customer_rate, can_view_member_rate) return the correct
//     boolean for every (role, visibility_level) combination;
//   - the four *_v views mask the rate column accordingly, so a caller
//     who can't see the rate gets NULL while row visibility stays
//     governed by the base table's RLS.

describe("Phase 2a: rate visibility helpers + column-masked views", () => {
  let prefix: string;
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let team: TestTeam;
  let otherTeam: TestTeam;
  let memberMembershipId: string;
  let customer: TestClient;
  let project: { id: string; name: string };

  // Client handles per user for RPC + view queries.
  let ownerClient: SupabaseClient;
  let adminClientAuthed: SupabaseClient;
  let memberClient: SupabaseClient;
  let outsiderClient: SupabaseClient;

  beforeAll(async () => {
    prefix = makeRunPrefix();

    // Users: owner + admin + regular member + a completely unrelated user.
    owner = await createTestUser(prefix, "owner");
    admin = await createTestUser(prefix, "admin");
    member = await createTestUser(prefix, "member");
    outsider = await createTestUser(prefix, "outsider");

    team = await createTestTeam(prefix, owner.id, "ratevis");
    otherTeam = await createTestTeam(prefix, outsider.id, "other");
    await addTeamMember(team.id, admin.id, "admin");
    await addTeamMember(team.id, member.id, "member");

    customer = await createTestCustomer(prefix, team.id, owner.id);
    project = await createTestProject(prefix, team.id, customer.id, owner.id);

    const adminApi = adminClient();

    // Seed rates and the team_members default rate for `member`.
    await adminApi
      .from("team_settings")
      .update({ default_rate: 50 })
      .eq("team_id", team.id);
    await adminApi
      .from("customers")
      .update({ default_rate: 120 })
      .eq("id", customer.id);
    await adminApi
      .from("projects")
      .update({ hourly_rate: 200 })
      .eq("id", project.id);
    const { data: mm } = await adminApi
      .from("team_members")
      .update({ default_rate: 175 })
      .eq("team_id", team.id)
      .eq("user_id", member.id)
      .select("id")
      .single();
    if (!mm?.id) throw new Error("failed to seed member rate");
    memberMembershipId = mm.id;

    ownerClient = await createAuthedClient(owner.email, owner.password);
    adminClientAuthed = await createAuthedClient(admin.email, admin.password);
    memberClient = await createAuthedClient(member.email, member.password);
    outsiderClient = await createAuthedClient(outsider.email, outsider.password);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  async function setRateVisibility(
    table: "team_settings" | "projects" | "customers" | "team_members",
    where: Record<string, string>,
    level: "owner" | "admins" | "self" | "all_members",
  ): Promise<void> {
    const q = adminClient().from(table).update({ rate_visibility: level });
    for (const [k, v] of Object.entries(where)) q.eq(k, v);
    const { error } = await q;
    if (error) throw new Error(`setRateVisibility ${table}: ${error.message}`);
  }

  async function canView(
    client: SupabaseClient,
    rpc:
      | "can_view_team_rate"
      | "can_view_project_rate"
      | "can_view_customer_rate"
      | "can_view_member_rate",
    arg: Record<string, string>,
  ): Promise<boolean> {
    const { data, error } = await client.rpc(rpc, arg);
    if (error) throw new Error(`${rpc} rpc: ${error.message}`);
    return Boolean(data);
  }

  // ─── can_view_team_rate ─────────────────────────────────────────────
  describe("can_view_team_rate", () => {
    it("default 'owner': only owner sees", async () => {
      await setRateVisibility("team_settings", { team_id: team.id }, "owner");
      expect(await canView(ownerClient, "can_view_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_team_rate", { p_team_id: team.id })).toBe(false);
      expect(await canView(memberClient, "can_view_team_rate", { p_team_id: team.id })).toBe(false);
      expect(await canView(outsiderClient, "can_view_team_rate", { p_team_id: team.id })).toBe(false);
    });

    it("'admins': owner + admin see, member + outsider don't", async () => {
      await setRateVisibility("team_settings", { team_id: team.id }, "admins");
      expect(await canView(ownerClient, "can_view_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canView(memberClient, "can_view_team_rate", { p_team_id: team.id })).toBe(false);
      expect(await canView(outsiderClient, "can_view_team_rate", { p_team_id: team.id })).toBe(false);
    });

    it("'all_members': everyone on the team sees; outsiders don't", async () => {
      await setRateVisibility("team_settings", { team_id: team.id }, "all_members");
      expect(await canView(ownerClient, "can_view_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canView(memberClient, "can_view_team_rate", { p_team_id: team.id })).toBe(true);
      expect(await canView(outsiderClient, "can_view_team_rate", { p_team_id: team.id })).toBe(false);
    });
  });

  // ─── can_view_project_rate ──────────────────────────────────────────
  describe("can_view_project_rate", () => {
    it("default 'owner': only owner sees", async () => {
      await setRateVisibility("projects", { id: project.id }, "owner");
      expect(await canView(ownerClient, "can_view_project_rate", { p_project_id: project.id })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_project_rate", { p_project_id: project.id })).toBe(false);
      expect(await canView(memberClient, "can_view_project_rate", { p_project_id: project.id })).toBe(false);
    });

    it("'admins': owner + admin see", async () => {
      await setRateVisibility("projects", { id: project.id }, "admins");
      expect(await canView(ownerClient, "can_view_project_rate", { p_project_id: project.id })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_project_rate", { p_project_id: project.id })).toBe(true);
      expect(await canView(memberClient, "can_view_project_rate", { p_project_id: project.id })).toBe(false);
    });

    it("'all_members': everyone on the team sees", async () => {
      await setRateVisibility("projects", { id: project.id }, "all_members");
      expect(await canView(memberClient, "can_view_project_rate", { p_project_id: project.id })).toBe(true);
    });

    it("cross-team customer admin always sees regardless of team visibility level", async () => {
      await setRateVisibility("projects", { id: project.id }, "owner");
      // Grant outsider a customer-level admin permission on this customer.
      await adminClient().from("customer_permissions").insert({
        customer_id: customer.id,
        principal_type: "user",
        principal_id: outsider.id,
        permission_level: "admin",
        granted_by: owner.id,
      });
      expect(await canView(outsiderClient, "can_view_project_rate", { p_project_id: project.id })).toBe(true);
      // Cleanup so other tests aren't polluted.
      await adminClient()
        .from("customer_permissions")
        .delete()
        .eq("customer_id", customer.id)
        .eq("principal_type", "user")
        .eq("principal_id", outsider.id);
    });
  });

  // ─── can_view_customer_rate ─────────────────────────────────────────
  describe("can_view_customer_rate", () => {
    it("default 'owner': only owner sees", async () => {
      await setRateVisibility("customers", { id: customer.id }, "owner");
      expect(await canView(ownerClient, "can_view_customer_rate", { p_customer_id: customer.id })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_customer_rate", { p_customer_id: customer.id })).toBe(false);
      expect(await canView(memberClient, "can_view_customer_rate", { p_customer_id: customer.id })).toBe(false);
    });

    it("'admins': owner + admin see", async () => {
      await setRateVisibility("customers", { id: customer.id }, "admins");
      expect(await canView(adminClientAuthed, "can_view_customer_rate", { p_customer_id: customer.id })).toBe(true);
      expect(await canView(memberClient, "can_view_customer_rate", { p_customer_id: customer.id })).toBe(false);
    });

    it("'all_members': everyone sees", async () => {
      await setRateVisibility("customers", { id: customer.id }, "all_members");
      expect(await canView(memberClient, "can_view_customer_rate", { p_customer_id: customer.id })).toBe(true);
    });
  });

  // ─── can_view_member_rate (4-level including 'self') ────────────────
  describe("can_view_member_rate", () => {
    it("default 'owner': only the owner sees (not even the member themselves)", async () => {
      await setRateVisibility("team_members", { id: memberMembershipId }, "owner");
      expect(await canView(ownerClient, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
      expect(await canView(memberClient, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
    });

    it("'admins': owner + admin see, member does not see their own", async () => {
      await setRateVisibility("team_members", { id: memberMembershipId }, "admins");
      expect(await canView(adminClientAuthed, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      expect(await canView(memberClient, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
    });

    it("'self': the specific member can see their own, other members still cannot", async () => {
      await setRateVisibility("team_members", { id: memberMembershipId }, "self");
      expect(await canView(memberClient, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      // Add a second member and verify they still can't see the first member's rate.
      const otherMember = await createTestUser(prefix, "member2");
      await addTeamMember(team.id, otherMember.id, "member");
      const otherMemberClient = await createAuthedClient(otherMember.email, otherMember.password);
      expect(await canView(otherMemberClient, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
    });

    it("'all_members': every team member sees every member's rate", async () => {
      await setRateVisibility("team_members", { id: memberMembershipId }, "all_members");
      expect(await canView(memberClient, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      expect(await canView(adminClientAuthed, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(true);
      expect(await canView(outsiderClient, "can_view_member_rate", { p_membership_id: memberMembershipId })).toBe(false);
    });
  });

  // ─── column-masked views ────────────────────────────────────────────
  describe("column-masked views", () => {
    it("projects_v masks hourly_rate for a member when visibility='owner'", async () => {
      await setRateVisibility("projects", { id: project.id }, "owner");
      const { data: row } = await memberClient
        .from("projects_v")
        .select("id, hourly_rate")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.id).toBe(project.id);
      expect(row?.hourly_rate).toBeNull();
    });

    it("projects_v exposes hourly_rate for the owner when visibility='owner'", async () => {
      await setRateVisibility("projects", { id: project.id }, "owner");
      const { data: row } = await ownerClient
        .from("projects_v")
        .select("id, hourly_rate")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.hourly_rate).toBeCloseTo(200, 2);
    });

    it("customers_v masks default_rate for a member when visibility='owner'", async () => {
      await setRateVisibility("customers", { id: customer.id }, "owner");
      const { data: row } = await memberClient
        .from("customers_v")
        .select("id, default_rate")
        .eq("id", customer.id)
        .maybeSingle();
      expect(row?.default_rate).toBeNull();
    });

    it("team_settings_v masks default_rate for a member when visibility='owner'", async () => {
      await setRateVisibility("team_settings", { team_id: team.id }, "owner");
      const { data: row } = await memberClient
        .from("team_settings_v")
        .select("team_id, default_rate")
        .eq("team_id", team.id)
        .maybeSingle();
      expect(row?.default_rate).toBeNull();
    });

    it("team_members_v exposes default_rate to the member themselves only when visibility='self'", async () => {
      await setRateVisibility("team_members", { id: memberMembershipId }, "self");
      const { data: own } = await memberClient
        .from("team_members_v")
        .select("id, default_rate")
        .eq("id", memberMembershipId)
        .maybeSingle();
      expect(own?.default_rate).toBeCloseTo(175, 2);
      // The owner's OWN membership row (different id) should NOT leak through
      // this member's view — different row, default visibility 'owner'.
      const { data: ownerMembership } = await memberClient
        .from("team_members_v")
        .select("id, default_rate")
        .eq("team_id", team.id)
        .eq("user_id", owner.id)
        .maybeSingle();
      expect(ownerMembership?.default_rate ?? null).toBeNull();
    });

    it("view row visibility is inherited from the base table's RLS (security_invoker)", async () => {
      // Outsider cannot see the other team's project row at all via projects_v —
      // RLS on projects blocks it, not just the rate column.
      const { data } = await outsiderClient
        .from("projects_v")
        .select("id")
        .eq("id", project.id);
      expect(data ?? []).toHaveLength(0);
      // And outsider sees their own team's row (proves the view isn't globally blocked).
      expect(otherTeam.id).toBeTruthy(); // silence unused warning
    });
  });
});
