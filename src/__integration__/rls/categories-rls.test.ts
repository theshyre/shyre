import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoTeamSharingScenario,
  TwoTeamSharingScenario,
} from "../helpers/fixtures";

/**
 * RLS for category_sets and categories.
 *
 * - System sets (is_system=true, org=NULL) readable by any authenticated user
 * - Org sets readable/writable only by org members
 * - Categories inherit their parent set's visibility
 * - Triggers enforce category belongs to project's set when assigned
 */
describe("category_sets + categories RLS", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;
  let aliceSetId: string;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);

    // Seed an org set owned by Alice's primary org
    const admin = adminClient();
    const { data: inserted, error } = await admin
      .from("category_sets")
      .insert({
        team_id: scenario.primaryTeam.id,
        name: `${prefix}alice-set`,
        description: "alice's categories",
        is_system: false,
        created_by: scenario.alice.id,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`setup: ${error?.message}`);
    aliceSetId = inserted.id;

    // Seed a couple categories
    await admin.from("categories").insert([
      {
        category_set_id: aliceSetId,
        name: `${prefix}feature`,
        color: "#3b82f6",
        sort_order: 10,
      },
      {
        category_set_id: aliceSetId,
        name: `${prefix}bug`,
        color: "#ef4444",
        sort_order: 20,
      },
    ]);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("any authenticated user can SELECT system sets", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data, error } = await eve
      .from("category_sets")
      .select("id, name")
      .eq("is_system", true);
    expect(error).toBeNull();
    // There are seeded system sets from the migration — at least one
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("Alice can SELECT her org's set", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("category_sets")
      .select("id")
      .eq("id", aliceSetId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Eve (outsider) CANNOT SELECT Alice's org set", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data, error } = await eve
      .from("category_sets")
      .select("id")
      .eq("id", aliceSetId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("Eve CANNOT INSERT a category_set into Alice's org", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { error } = await eve
      .from("category_sets")
      .insert({
        team_id: scenario.primaryTeam.id,
        name: `${prefix}eve-spoof`,
        is_system: false,
        created_by: scenario.eve.id,
      })
      .select("id")
      .single();
    expect(error).toBeTruthy();
  });

  it("Eve CANNOT modify a system set", async () => {
    const admin = adminClient();
    const { data: sys } = await admin
      .from("category_sets")
      .select("id")
      .eq("is_system", true)
      .limit(1)
      .single();
    if (!sys) throw new Error("no system set to test against");

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { error } = await eve
      .from("category_sets")
      .update({ name: "hijacked" })
      .eq("id", sys.id);
    // RLS should either error or silently no-op. Verify row untouched.
    const { data: after } = await admin
      .from("category_sets")
      .select("name")
      .eq("id", sys.id)
      .single();
    expect(after?.name).not.toBe("hijacked");
    if (error) expect(error).toBeTruthy();
  });

  it("Alice can SELECT her categories via the set join", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("categories")
      .select("id, name")
      .eq("category_set_id", aliceSetId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("Eve CANNOT SELECT Alice's categories", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data } = await eve
      .from("categories")
      .select("id")
      .eq("category_set_id", aliceSetId);
    expect(data ?? []).toHaveLength(0);
  });

  it("assigning a category to a time_entry fails when project has no set", async () => {
    // Alice's project is created without a category_set_id.
    // Inserting an entry with category_id set must fail via trigger.
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );

    // First, get one of her category ids
    const { data: cats } = await alice
      .from("categories")
      .select("id")
      .eq("category_set_id", aliceSetId)
      .limit(1);
    const catId = cats?.[0]?.id;
    expect(catId).toBeTruthy();

    const now = new Date();
    const start = new Date(now.getTime() - 3600_000);
    const { error } = await alice
      .from("time_entries")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        description: `${prefix}trigger-test`,
        start_time: start.toISOString(),
        end_time: now.toISOString(),
        billable: true,
        category_id: catId,
      })
      .select("id")
      .single();
    expect(error).toBeTruthy();
  });

  it("assigning a matching category succeeds when the project has that set", async () => {
    // Link Alice's project to her set (admin bypass for test setup)
    const admin = adminClient();
    await admin
      .from("projects")
      .update({ category_set_id: aliceSetId })
      .eq("id", scenario.project.id);

    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data: cats } = await alice
      .from("categories")
      .select("id")
      .eq("category_set_id", aliceSetId)
      .limit(1);
    const catId = cats?.[0]?.id;

    const now = new Date();
    const start = new Date(now.getTime() - 3600_000);
    const { data, error } = await alice
      .from("time_entries")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        description: `${prefix}trigger-match`,
        start_time: start.toISOString(),
        end_time: now.toISOString(),
        billable: true,
        category_id: catId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data).toBeTruthy();

    // Cleanup
    if (data?.id) await admin.from("time_entries").delete().eq("id", data.id);
    await admin
      .from("projects")
      .update({ category_set_id: null })
      .eq("id", scenario.project.id);
  });
});
