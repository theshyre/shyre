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
  createTestTimeEntry,
  TestClient,
} from "../helpers/customers";

// Phase 3 — configurable time_entries visibility. Verifies that the
// effective_time_entries_visibility helper resolves correctly
// (project overrides team) and that the RLS policies (select / update /
// delete) honor the level for plain members.

describe("Phase 3: time_entries visibility config", () => {
  let prefix: string;
  let owner: TestUser;
  let member: TestUser;
  let team: TestTeam;
  let customer: TestClient;
  let project: { id: string; name: string };
  let ownerEntryId: string;

  let memberClient: SupabaseClient;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    owner = await createTestUser(prefix, "owner");
    member = await createTestUser(prefix, "member");

    team = await createTestTeam(prefix, owner.id, "tevis");
    await addTeamMember(team.id, member.id, "member");

    customer = await createTestCustomer(prefix, team.id, owner.id);
    project = await createTestProject(prefix, team.id, customer.id, owner.id);

    const ownerEntry = await createTestTimeEntry(
      prefix,
      team.id,
      project.id,
      owner.id,
      { description: "owner-entry" },
    );
    ownerEntryId = ownerEntry.id;

    memberClient = await createAuthedClient(member.email, member.password);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  async function setTeamLevel(
    level: "own_only" | "read_all" | "read_write_all",
  ): Promise<void> {
    const { error } = await adminClient()
      .from("team_settings")
      .update({ time_entries_visibility: level })
      .eq("team_id", team.id);
    if (error) throw new Error(error.message);
  }

  async function setProjectLevel(
    level: "own_only" | "read_all" | "read_write_all" | null,
  ): Promise<void> {
    const { error } = await adminClient()
      .from("projects")
      .update({ time_entries_visibility: level })
      .eq("id", project.id);
    if (error) throw new Error(error.message);
  }

  async function memberCanSelectOwnerEntry(): Promise<boolean> {
    const { data } = await memberClient
      .from("time_entries")
      .select("id")
      .eq("id", ownerEntryId);
    return (data ?? []).length > 0;
  }

  describe("effective_time_entries_visibility helper", () => {
    it("falls back to team level when project level is NULL", async () => {
      await setProjectLevel(null);
      await setTeamLevel("read_all");
      const { data } = await memberClient.rpc(
        "effective_time_entries_visibility",
        { p_project_id: project.id, p_team_id: team.id },
      );
      expect(data).toBe("read_all");
    });

    it("project level wins when set", async () => {
      await setTeamLevel("own_only");
      await setProjectLevel("read_write_all");
      const { data } = await memberClient.rpc(
        "effective_time_entries_visibility",
        { p_project_id: project.id, p_team_id: team.id },
      );
      expect(data).toBe("read_write_all");
    });

    it("defaults to own_only when neither is set", async () => {
      // Inconsistent to test on the real tables since the CHECK / DEFAULT
      // keep team at some value; this test instead exercises the COALESCE
      // fallback by passing a nonexistent project+team.
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const { data } = await memberClient.rpc(
        "effective_time_entries_visibility",
        { p_project_id: fakeId, p_team_id: fakeId },
      );
      expect(data).toBe("own_only");
    });
  });

  describe("RLS honors the config for plain members", () => {
    it("own_only (default): member cannot SELECT owner's entry", async () => {
      await setTeamLevel("own_only");
      await setProjectLevel(null);
      expect(await memberCanSelectOwnerEntry()).toBe(false);
    });

    it("team read_all: member CAN SELECT owner's entry", async () => {
      await setTeamLevel("read_all");
      await setProjectLevel(null);
      expect(await memberCanSelectOwnerEntry()).toBe(true);
    });

    it("project override wins: team=own_only + project=read_all → member sees", async () => {
      await setTeamLevel("own_only");
      await setProjectLevel("read_all");
      expect(await memberCanSelectOwnerEntry()).toBe(true);
    });

    it("project override locks down: team=read_all + project=own_only → member blocked", async () => {
      await setTeamLevel("read_all");
      await setProjectLevel("own_only");
      expect(await memberCanSelectOwnerEntry()).toBe(false);
    });

    it("read_all: member can SELECT but cannot UPDATE owner's entry", async () => {
      await setTeamLevel("read_all");
      await setProjectLevel(null);
      expect(await memberCanSelectOwnerEntry()).toBe(true);
      const { error } = await memberClient
        .from("time_entries")
        .update({ description: "hijack" })
        .eq("id", ownerEntryId);
      // RLS will either silently return zero rows affected or error,
      // depending on Postgres behavior for UPDATE policy mismatches. Either
      // way the row's description should still be "owner-entry".
      void error;
      const { data: row } = await adminClient()
        .from("time_entries")
        .select("description")
        .eq("id", ownerEntryId)
        .single();
      expect(row?.description).toBe(`${prefix}owner-entry`);
    });

    it("read_write_all: member CAN UPDATE owner's entry", async () => {
      await setTeamLevel("read_write_all");
      await setProjectLevel(null);
      const { error } = await memberClient
        .from("time_entries")
        .update({ description: `${prefix}member-edit` })
        .eq("id", ownerEntryId);
      expect(error).toBeNull();
      const { data: row } = await adminClient()
        .from("time_entries")
        .select("description")
        .eq("id", ownerEntryId)
        .single();
      expect(row?.description).toBe(`${prefix}member-edit`);

      // Reset for the next test.
      await adminClient()
        .from("time_entries")
        .update({ description: `${prefix}owner-entry` })
        .eq("id", ownerEntryId);
    });

    it("INSERT stays own-only even under read_write_all (no insert-on-behalf)", async () => {
      await setTeamLevel("read_write_all");
      await setProjectLevel(null);
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 60 * 1000);
      const { error } = await memberClient
        .from("time_entries")
        .insert({
          team_id: team.id,
          user_id: owner.id, // pretending to log time FOR the owner
          project_id: project.id,
          description: `${prefix}forged`,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          billable: true,
        })
        .select("id");
      expect(error).not.toBeNull();
    });
  });
});
