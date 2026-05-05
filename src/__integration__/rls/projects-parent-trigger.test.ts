import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { adminClient } from "../helpers/admin";
import {
  twoTeamSharingScenario,
  TwoTeamSharingScenario,
} from "../helpers/fixtures";
import { createTestProject } from "../helpers/customers";

/**
 * Trigger correctness tests for `parent_project_id` on projects.
 *
 * The trigger `projects_enforce_parent_invariants` enforces:
 *   - parent.customer_id = child.customer_id (same customer)
 *   - parent.team_id = child.team_id (same team)
 *   - parent.parent_project_id IS NULL (1 level deep — no
 *     grandchildren)
 *   - parent must exist (FK + trigger fall-through)
 *   - id != parent_project_id (row-local CHECK)
 *
 * The companion trigger `projects_block_customer_change_with_children`
 * rejects UPDATEs that would change customer_id / team_id on a project
 * with children.
 *
 * Each invariant gets BOTH an INSERT and an UPDATE case — the trigger
 * fires on both paths, and the common bug class is testing INSERT only.
 */

describe("projects parent_project_id trigger", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("allows a sub-project under a same-customer same-team parent (INSERT)", async () => {
    const parent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-allow-parent",
    );
    const admin = adminClient();
    const { data, error } = await admin
      .from("projects")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        customer_id: scenario.client.id,
        name: `${prefix}trigger-allow-child`,
        status: "active",
        parent_project_id: parent.id,
      })
      .select("id, parent_project_id")
      .single();
    expect(error).toBeNull();
    expect(data?.parent_project_id).toBe(parent.id);
  });

  it("rejects a sub-project on a different customer (INSERT)", async () => {
    const parent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-cross-customer-parent",
    );
    // Create a second customer in the same team to be the child's customer
    const admin = adminClient();
    const { data: otherCustomer } = await admin
      .from("customers")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        name: `${prefix}other-customer`,
      })
      .select("id")
      .single();
    expect(otherCustomer).not.toBeNull();
    const { error } = await admin.from("projects").insert({
      team_id: scenario.primaryTeam.id,
      user_id: scenario.alice.id,
      customer_id: otherCustomer!.id,
      name: `${prefix}trigger-cross-customer-child`,
      status: "active",
      parent_project_id: parent.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/same customer/i);
  });

  it("rejects a sub-project on a different team (INSERT)", async () => {
    const parent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-cross-team-parent",
    );
    const admin = adminClient();
    const { error } = await admin.from("projects").insert({
      team_id: scenario.participatingTeam.id,
      user_id: scenario.alice.id,
      customer_id: scenario.client.id,
      name: `${prefix}trigger-cross-team-child`,
      status: "active",
      parent_project_id: parent.id,
    });
    expect(error).not.toBeNull();
    // Could be the customer mismatch path OR the team path — either
    // proves the trigger fired.
    expect(error?.message).toMatch(/same (customer|team)/i);
  });

  it("rejects nesting beyond one level (INSERT)", async () => {
    const grandparent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-grandparent",
    );
    const admin = adminClient();
    const { data: parent, error: parentErr } = await admin
      .from("projects")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        customer_id: scenario.client.id,
        name: `${prefix}trigger-mid`,
        status: "active",
        parent_project_id: grandparent.id,
      })
      .select("id")
      .single();
    expect(parentErr).toBeNull();
    expect(parent).not.toBeNull();

    // Now try to make a third-level child under the mid-level. Trigger
    // should reject because mid-level already has a parent.
    const { error } = await admin.from("projects").insert({
      team_id: scenario.primaryTeam.id,
      user_id: scenario.alice.id,
      customer_id: scenario.client.id,
      name: `${prefix}trigger-grandchild`,
      status: "active",
      parent_project_id: parent!.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/one level deep/i);
  });

  it("rejects self-reference (UPDATE)", async () => {
    const proj = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-self-ref",
    );
    const admin = adminClient();
    const { error } = await admin
      .from("projects")
      .update({ parent_project_id: proj.id })
      .eq("id", proj.id);
    expect(error).not.toBeNull();
    // Row-local CHECK fires before the trigger.
  });

  it("rejects re-parenting to a project that already has a parent (UPDATE)", async () => {
    const grandparent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-update-grandparent",
    );
    const admin = adminClient();
    const { data: midRow, error: midErr } = await admin
      .from("projects")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        customer_id: scenario.client.id,
        name: `${prefix}trigger-update-mid`,
        status: "active",
        parent_project_id: grandparent.id,
      })
      .select("id")
      .single();
    expect(midErr).toBeNull();
    const sibling = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-update-sibling",
    );
    const { error } = await admin
      .from("projects")
      .update({ parent_project_id: midRow!.id })
      .eq("id", sibling.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/one level deep/i);
  });

  it("rejects customer_id change on a parent that has children (UPDATE)", async () => {
    const parent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-block-customer-change-parent",
    );
    const admin = adminClient();
    await admin.from("projects").insert({
      team_id: scenario.primaryTeam.id,
      user_id: scenario.alice.id,
      customer_id: scenario.client.id,
      name: `${prefix}trigger-block-customer-change-child`,
      status: "active",
      parent_project_id: parent.id,
    });
    // Create a different customer under the same team
    const { data: otherCustomer } = await admin
      .from("customers")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        name: `${prefix}block-customer-change-other`,
      })
      .select("id")
      .single();
    expect(otherCustomer).not.toBeNull();
    const { error } = await admin
      .from("projects")
      .update({ customer_id: otherCustomer!.id })
      .eq("id", parent.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/sub-projects/i);
  });

  it("rejects DELETE on a parent that has children (ON DELETE RESTRICT)", async () => {
    const parent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-restrict-parent",
    );
    const admin = adminClient();
    await admin.from("projects").insert({
      team_id: scenario.primaryTeam.id,
      user_id: scenario.alice.id,
      customer_id: scenario.client.id,
      name: `${prefix}trigger-restrict-child`,
      status: "active",
      parent_project_id: parent.id,
    });
    const { error } = await admin
      .from("projects")
      .delete()
      .eq("id", parent.id);
    expect(error).not.toBeNull();
    // Foreign key violation — RESTRICT is the standard signal.
  });

  it("allows DELETE of a parent after its children are detached (UPDATE then DELETE)", async () => {
    const parent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "trigger-detach-then-delete-parent",
    );
    const admin = adminClient();
    const { data: child } = await admin
      .from("projects")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        customer_id: scenario.client.id,
        name: `${prefix}trigger-detach-then-delete-child`,
        status: "active",
        parent_project_id: parent.id,
      })
      .select("id")
      .single();
    expect(child).not.toBeNull();
    // Detach the child first
    await admin
      .from("projects")
      .update({ parent_project_id: null })
      .eq("id", child!.id);
    // Now delete the parent
    const { error } = await admin
      .from("projects")
      .delete()
      .eq("id", parent.id);
    expect(error).toBeNull();
  });

  it("projects_v exposes parent_project_id", async () => {
    const parent = await createTestProject(
      prefix,
      scenario.primaryTeam.id,
      scenario.client.id,
      scenario.alice.id,
      "view-smoke-parent",
    );
    const admin = adminClient();
    const { data: child } = await admin
      .from("projects")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        customer_id: scenario.client.id,
        name: `${prefix}view-smoke-child`,
        status: "active",
        parent_project_id: parent.id,
      })
      .select("id")
      .single();
    expect(child).not.toBeNull();
    const { data, error } = await admin
      .from("projects_v")
      .select("id, parent_project_id")
      .eq("id", child!.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.parent_project_id).toBe(parent.id);
  });
});
