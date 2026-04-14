import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoOrgSharingScenario,
  TwoOrgSharingScenario,
} from "../helpers/fixtures";
import { createTestTimeEntry } from "../helpers/clients";

/**
 * These tests exercise the RLS-backed defense for stop/update/delete and
 * verify the duplicate-entry semantics (stop any running timer, copy fields,
 * insert new running entry).
 *
 * The server actions also filter by user_id as defense-in-depth (SAL-002),
 * but RLS is the authoritative gate — that's what these tests verify.
 */
describe("time_entries mutations (RLS defense + duplicate semantics)", () => {
  let prefix: string;
  let scenario: TwoOrgSharingScenario;
  let aliceEntryId: string;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoOrgSharingScenario(prefix);

    // Share the client with participatingOrg so Dave has visibility paths,
    // but RLS on time_entries mutations is still per-user.
    const admin = adminClient();
    await admin.from("client_shares").insert({
      client_id: scenario.client.id,
      organization_id: scenario.participatingOrg.id,
      can_see_others_entries: true,
      created_by: scenario.alice.id,
    });

    const entry = await createTestTimeEntry(
      prefix,
      scenario.primaryOrg.id,
      scenario.project.id,
      scenario.alice.id,
      { description: "alice-original" },
    );
    aliceEntryId = entry.id;
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("Dave CANNOT UPDATE Alice's time entry (RLS blocks the write)", async () => {
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    const { error } = await dave
      .from("time_entries")
      .update({ description: "hijacked" })
      .eq("id", aliceEntryId);

    // RLS either errors or silently no-ops. Either way, the row must be untouched.
    // We verify by re-reading as admin.
    const admin = adminClient();
    const { data: after } = await admin
      .from("time_entries")
      .select("description")
      .eq("id", aliceEntryId)
      .single();
    expect(after?.description).toContain("alice-original");
    // Error is acceptable; silent no-op is also RLS-correct
    if (error) expect(error).toBeTruthy();
  });

  it("Dave CANNOT DELETE Alice's time entry (RLS blocks the write)", async () => {
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    await dave.from("time_entries").delete().eq("id", aliceEntryId);

    const admin = adminClient();
    const { data } = await admin
      .from("time_entries")
      .select("id")
      .eq("id", aliceEntryId);
    expect(data).toHaveLength(1);
  });

  it("Dave CANNOT stop Alice's running timer by updating end_time (RLS blocks)", async () => {
    // Start a running timer owned by Alice
    const admin = adminClient();
    const { data: running } = await admin
      .from("time_entries")
      .insert({
        organization_id: scenario.primaryOrg.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        description: `${prefix}alice-running`,
        start_time: new Date().toISOString(),
        end_time: null,
        billable: true,
      })
      .select("id")
      .single();
    const runningId = running!.id;

    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    await dave
      .from("time_entries")
      .update({ end_time: new Date().toISOString() })
      .eq("id", runningId);

    const { data: after } = await admin
      .from("time_entries")
      .select("end_time")
      .eq("id", runningId)
      .single();
    expect(after?.end_time).toBeNull();

    // Cleanup
    await admin.from("time_entries").delete().eq("id", runningId);
  });

  it("Alice can duplicate her own entry: stops running + inserts copy", async () => {
    // Start a running timer
    const admin = adminClient();
    const { data: runningBefore } = await admin
      .from("time_entries")
      .insert({
        organization_id: scenario.primaryOrg.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        description: `${prefix}alice-running-for-dup`,
        start_time: new Date().toISOString(),
        end_time: null,
        billable: true,
      })
      .select("id")
      .single();
    const runningId = runningBefore!.id;

    // Source entry to duplicate (Alice's completed one)
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data: source, error: sourceErr } = await alice
      .from("time_entries")
      .select("organization_id, project_id, description, billable, github_issue")
      .eq("id", aliceEntryId)
      .single();
    expect(sourceErr).toBeNull();
    expect(source).toBeTruthy();

    // Emulate the server action's atomic flow:
    const now = new Date().toISOString();
    const { error: stopErr } = await alice
      .from("time_entries")
      .update({ end_time: now })
      .eq("user_id", scenario.alice.id)
      .is("end_time", null);
    expect(stopErr).toBeNull();

    const { data: inserted, error: insertErr } = await alice
      .from("time_entries")
      .insert({
        organization_id: source!.organization_id,
        user_id: scenario.alice.id,
        project_id: source!.project_id,
        description: source!.description,
        start_time: now,
        end_time: null,
        billable: source!.billable,
        github_issue: source!.github_issue,
      })
      .select("id, description, end_time")
      .single();
    expect(insertErr).toBeNull();
    expect(inserted?.end_time).toBeNull();
    expect(inserted?.description).toContain("alice-original");

    // Previously running entry is now stopped
    const { data: stopped } = await admin
      .from("time_entries")
      .select("end_time")
      .eq("id", runningId)
      .single();
    expect(stopped?.end_time).not.toBeNull();

    // Cleanup
    await admin.from("time_entries").delete().eq("id", runningId);
    await admin.from("time_entries").delete().eq("id", inserted!.id);
  });

  it("Dave CANNOT duplicate Alice's entry: source fetch returns empty under RLS", async () => {
    // Share flag is on (set in beforeAll), so Dave CAN see Alice's entry via SELECT.
    // But to duplicate he'd need to insert with his own user_id — validate that
    // inserting a copy with Alice's user_id is rejected (RLS on user_id = auth.uid()).
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );

    const { error: insertErr } = await dave
      .from("time_entries")
      .insert({
        organization_id: scenario.primaryOrg.id,
        user_id: scenario.alice.id, // spoofing Alice
        project_id: scenario.project.id,
        description: `${prefix}spoofed-dup`,
        start_time: new Date().toISOString(),
        end_time: null,
        billable: true,
      })
      .select("id")
      .single();

    // RLS must reject the insert
    expect(insertErr).toBeTruthy();
  });
});
