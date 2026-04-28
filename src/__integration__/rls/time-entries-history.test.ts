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
 * Audit trail for time_entries (migration
 * 20260428025103_time_entries_audit_trail.sql).
 *
 * Verifies:
 *   - UPDATE captures the pre-change state in time_entries_history
 *   - DELETE captures the pre-change state in time_entries_history
 *   - INSERT does NOT log (the row + its created_at IS the create
 *     record)
 *   - SELECT policy: author OR owner|admin; outsider sees nothing
 */
describe("time_entries_history", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  async function seedEntry(
    description: string,
  ): Promise<{ id: string; description: string }> {
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const { data, error } = await adminClient()
      .from("time_entries")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        description: `${prefix}${description}`,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      })
      .select("id, description")
      .single();
    if (error || !data) throw new Error(`seed: ${error?.message}`);
    return data as { id: string; description: string };
  }

  it("INSERT does NOT produce a history row", async () => {
    const entry = await seedEntry("no-history-on-insert");
    const { data } = await adminClient()
      .from("time_entries_history")
      .select("id")
      .eq("time_entry_id", entry.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("UPDATE captures the pre-change description in history", async () => {
    const entry = await seedEntry("before-edit");

    const { error: updateErr } = await adminClient()
      .from("time_entries")
      .update({ description: `${prefix}after-edit` })
      .eq("id", entry.id);
    expect(updateErr).toBeNull();

    const { data, error } = await adminClient()
      .from("time_entries_history")
      .select("operation, previous_state")
      .eq("time_entry_id", entry.id);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(data?.[0]?.operation).toBe("UPDATE");
    expect(
      (data?.[0]?.previous_state as { description: string } | null)
        ?.description,
    ).toBe(entry.description);
  });

  it("DELETE captures the pre-delete state in history", async () => {
    const entry = await seedEntry("to-be-deleted");

    const { error: deleteErr } = await adminClient()
      .from("time_entries")
      .delete()
      .eq("id", entry.id);
    expect(deleteErr).toBeNull();

    const { data } = await adminClient()
      .from("time_entries_history")
      .select("operation, previous_state, time_entry_id")
      .eq("time_entry_id", entry.id);
    expect(data ?? []).toHaveLength(1);
    expect(data?.[0]?.operation).toBe("DELETE");
    expect(
      (data?.[0]?.previous_state as { description: string } | null)
        ?.description,
    ).toBe(entry.description);
  });

  it("author can SELECT their own entry's history", async () => {
    const entry = await seedEntry("alice-own-history");
    await adminClient()
      .from("time_entries")
      .update({ description: `${prefix}edited-by-alice` })
      .eq("id", entry.id);

    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("time_entries_history")
      .select("id")
      .eq("time_entry_id", entry.id);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("non-author plain member CANNOT SELECT another member's history", async () => {
    const entry = await seedEntry("alice-private");
    await adminClient()
      .from("time_entries")
      .update({ description: `${prefix}edited-private` })
      .eq("id", entry.id);

    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data, error } = await carol
      .from("time_entries_history")
      .select("id")
      .eq("time_entry_id", entry.id);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("outsider in another team sees zero", async () => {
    const entry = await seedEntry("outsider-blocked");
    await adminClient()
      .from("time_entries")
      .update({ description: `${prefix}edited-blocked` })
      .eq("id", entry.id);

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data } = await eve
      .from("time_entries_history")
      .select("id")
      .eq("time_entry_id", entry.id);
    expect(data ?? []).toHaveLength(0);
  });
});
