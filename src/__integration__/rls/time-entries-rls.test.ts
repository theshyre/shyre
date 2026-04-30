import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoTeamSharingScenario,
  TwoTeamSharingScenario,
} from "../helpers/fixtures";
import { createTestTimeEntry } from "../helpers/customers";
import { setMembershipJoinedAt } from "../helpers/teams";
import { selfScopedFloor } from "@/lib/time/membership";

describe("time_entries RLS (cross-org sharing)", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;
  let daveEntryId: string;
  let aliceEntryId: string;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);

    // Share the client with participatingTeam, initially without can_see_others_entries
    const admin = adminClient();
    await admin.from("customer_shares").insert({
      customer_id: scenario.client.id,
      team_id: scenario.participatingTeam.id,
      can_see_others_entries: false,
      created_by: scenario.alice.id,
    });

    // Seed Alice's time entry (primary org user) directly via admin helper
    const aliceEntry = await createTestTimeEntry(
      prefix,
      scenario.primaryTeam.id,
      scenario.project.id,
      scenario.alice.id,
      { description: "alice-entry" },
    );
    aliceEntryId = aliceEntry.id;
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  it("participating user (Dave) can INSERT a time_entry on the shared project", async () => {
    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );

    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);

    const { data, error } = await dave
      .from("time_entries")
      .insert({
        team_id: scenario.participatingTeam.id,
        user_id: scenario.dave.id,
        project_id: scenario.project.id,
        description: `${prefix}dave-entry`,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        billable: true,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    daveEntryId = data!.id;
  });

  it("Alice (primary org) can SELECT Dave's cross-org entry", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("time_entries")
      .select("id")
      .eq("id", daveEntryId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Bob (same participating org as Dave) can SELECT Dave's entry", async () => {
    const bob = await createAuthedClient(
      scenario.bob.email,
      scenario.bob.password,
    );
    const { data, error } = await bob
      .from("time_entries")
      .select("id")
      .eq("id", daveEntryId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Dave CANNOT SELECT Alice's entry when can_see_others_entries=false", async () => {
    // Ensure the flag is false
    const admin = adminClient();
    await admin
      .from("customer_shares")
      .update({ can_see_others_entries: false })
      .eq("customer_id", scenario.client.id)
      .eq("team_id", scenario.participatingTeam.id);

    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    const { data, error } = await dave
      .from("time_entries")
      .select("id")
      .eq("id", aliceEntryId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("toggling can_see_others_entries=true grants Dave visibility on Alice's entry", async () => {
    const admin = adminClient();
    await admin
      .from("customer_shares")
      .update({ can_see_others_entries: true })
      .eq("customer_id", scenario.client.id)
      .eq("team_id", scenario.participatingTeam.id);

    const dave = await createAuthedClient(
      scenario.dave.email,
      scenario.dave.password,
    );
    const { data, error } = await dave
      .from("time_entries")
      .select("id")
      .eq("id", aliceEntryId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("Eve (outsider, no share) cannot SELECT any entries on the client's project", async () => {
    // Make sure Eve has no lingering permission row
    const admin = adminClient();
    await admin
      .from("customer_permissions")
      .delete()
      .eq("customer_id", scenario.client.id)
      .eq("principal_type", "user")
      .eq("principal_id", scenario.eve.id);

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data, error } = await eve
      .from("time_entries")
      .select("id")
      .in("id", [aliceEntryId, daveEntryId]);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  describe("SAL-006: same-team member visibility is tight by default", () => {
    it("Carol (member of primaryTeam) cannot SELECT Alice's (owner) entry in the same team", async () => {
      // Alice is owner of primaryTeam; Carol is a plain member of the same team.
      // Under the tight default, a member sees only their own entries — even
      // though they share a team with the entry's author.
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const { data, error } = await carol
        .from("time_entries")
        .select("id")
        .eq("id", aliceEntryId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("Carol CAN still SELECT her own entry", async () => {
      // Seed a Carol-owned entry via admin, then confirm she can read it.
      const carolEntry = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.carol.id,
        { description: "carol-own-entry" },
      );
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const { data, error } = await carol
        .from("time_entries")
        .select("id")
        .eq("id", carolEntry.id);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("Alice (owner of primaryTeam) CAN SELECT Carol's entry in the same team", async () => {
      // The owner still sees everything in their team — own + admin bypass.
      const carolEntry = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.carol.id,
        { description: "carol-for-alice" },
      );
      const alice = await createAuthedClient(
        scenario.alice.email,
        scenario.alice.password,
      );
      const { data, error } = await alice
        .from("time_entries")
        .select("id")
        .eq("id", carolEntry.id);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Unified Time view — deep-scroll RLS regression baseline.
  //
  // Phase 1 of the Unified Time view rollout (see
  // docs/reference/unified-time.md). The Log will widen the access pattern
  // from "single week" to "5+ years" so this `describe` exercises SAL-006
  // visibility under the broader window. Personas: member-self,
  // member-other, owner. Both directions per the SAL-003 template
  // (allowed-succeeds AND blocked-zero).
  // -------------------------------------------------------------------------
  describe("Unified Time view: deep-scroll respects SAL-006", () => {
    let aliceOldId: string;
    let aliceMidId: string;
    let aliceRecentId: string;
    let carolOldId: string;
    let carolRecentId: string;

    const FIVE_YEARS_AGO = new Date("2021-04-30T10:00:00.000Z");
    const TWO_YEARS_AGO = new Date("2024-04-30T10:00:00.000Z");
    const RECENT = new Date("2026-04-25T10:00:00.000Z");

    beforeAll(async () => {
      // Seed entries spanning a 5-year window for both Alice (owner) and
      // Carol (member of primaryTeam).
      const aliceOld = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.alice.id,
        { description: "alice-5y-ago", startTime: FIVE_YEARS_AGO },
      );
      aliceOldId = aliceOld.id;
      const aliceMid = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.alice.id,
        { description: "alice-2y-ago", startTime: TWO_YEARS_AGO },
      );
      aliceMidId = aliceMid.id;
      const aliceRecent = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.alice.id,
        { description: "alice-recent", startTime: RECENT },
      );
      aliceRecentId = aliceRecent.id;

      const carolOld = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.carol.id,
        { description: "carol-5y-ago", startTime: FIVE_YEARS_AGO },
      );
      carolOldId = carolOld.id;
      const carolRecent = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.carol.id,
        { description: "carol-recent", startTime: RECENT },
      );
      carolRecentId = carolRecent.id;
    });

    it("Alice (owner) sees ALL team entries across the full 5-year window", async () => {
      const alice = await createAuthedClient(
        scenario.alice.email,
        scenario.alice.password,
      );
      const { data, error } = await alice
        .from("time_entries")
        .select("id")
        .in("id", [
          aliceOldId,
          aliceMidId,
          aliceRecentId,
          carolOldId,
          carolRecentId,
        ]);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(5);
    });

    it("Carol (member) sees ONLY her own entries across the full 5-year window", async () => {
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const { data, error } = await carol
        .from("time_entries")
        .select("id")
        .in("id", [
          aliceOldId,
          aliceMidId,
          aliceRecentId,
          carolOldId,
          carolRecentId,
        ]);
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      expect(ids.has(carolOldId)).toBe(true);
      expect(ids.has(carolRecentId)).toBe(true);
      expect(ids.has(aliceOldId)).toBe(false);
      expect(ids.has(aliceMidId)).toBe(false);
      expect(ids.has(aliceRecentId)).toBe(false);
    });

    it("Eve (outsider) sees ZERO entries across the full 5-year window", async () => {
      const eve = await createAuthedClient(
        scenario.eve.email,
        scenario.eve.password,
      );
      const { data, error } = await eve
        .from("time_entries")
        .select("id")
        .in("id", [
          aliceOldId,
          aliceMidId,
          aliceRecentId,
          carolOldId,
          carolRecentId,
        ]);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("a Carol-scoped 5y range query returns exactly Carol's entries (cursor-style)", async () => {
      // Mirrors the Log's per-page fetch shape: bounded range + cursor-style
      // ORDER BY (start_time DESC, id DESC). Validates the new composite
      // index path doesn't leak.
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const { data, error } = await carol
        .from("time_entries")
        .select("id, user_id, start_time")
        .gte("start_time", FIVE_YEARS_AGO.toISOString())
        .lt("start_time", new Date(RECENT.getTime() + 24 * 3600 * 1000).toISOString())
        .order("start_time", { ascending: false })
        .order("id", { ascending: false });
      expect(error).toBeNull();
      const carolUserIds = new Set((data ?? []).map((r) => r.user_id));
      expect(carolUserIds.has(scenario.carol.id)).toBe(true);
      expect(carolUserIds.has(scenario.alice.id)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Pre-membership defense-in-depth filter.
  //
  // RLS allows a member to read their own entries on a team they currently
  // belong to — including entries whose start_time predates joined_at. The
  // self-scoped floor (src/lib/time/membership.ts) clamps this away at the
  // action layer so a re-added member's deep-scroll never surfaces pre-leave
  // entries. See docs/reference/unified-time.md §Authorization.
  // -------------------------------------------------------------------------
  describe("self-scoped pre-membership floor", () => {
    let preJoinId: string;
    let postJoinId: string;
    const PRE_JOIN_START = new Date("2024-06-01T10:00:00.000Z");
    const POST_JOIN_START = new Date("2026-04-25T10:00:00.000Z");
    const NEW_JOINED_AT = new Date("2026-01-01T00:00:00.000Z");

    beforeAll(async () => {
      // Seed two Carol-owned entries on primaryTeam — one before her
      // (forthcoming) joined_at, one after.
      const pre = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.carol.id,
        { description: "carol-pre-join", startTime: PRE_JOIN_START },
      );
      preJoinId = pre.id;
      const post = await createTestTimeEntry(
        prefix,
        scenario.primaryTeam.id,
        scenario.project.id,
        scenario.carol.id,
        { description: "carol-post-join", startTime: POST_JOIN_START },
      );
      postJoinId = post.id;

      // Bump Carol's membership.joined_at forward (the real-world shape:
      // Carol left, was re-added on 2026-01-01).
      await setMembershipJoinedAt(
        scenario.primaryTeam.id,
        scenario.carol.id,
        NEW_JOINED_AT,
      );
    });

    it("RLS alone still permits Carol to read her pre-join entry (baseline)", async () => {
      // Establishes the gap: without the action-layer floor, a deep scroll
      // would surface this row. The floor is the gate; RLS is not.
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const { data, error } = await carol
        .from("time_entries")
        .select("id")
        .in("id", [preJoinId, postJoinId]);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id).sort()).toEqual(
        [preJoinId, postJoinId].sort(),
      );
    });

    it("selfScopedFloor returns joined_at when self-scoped on a single team", async () => {
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const windowStart = new Date("2020-01-01T00:00:00.000Z"); // far before joined_at
      const floor = await selfScopedFloor(
        carol,
        scenario.carol.id,
        scenario.primaryTeam.id,
        [scenario.carol.id],
        windowStart,
      );
      expect(floor.toISOString()).toBe(NEW_JOINED_AT.toISOString());
    });

    it("applying the floor as a query bound hides the pre-join row", async () => {
      // End-to-end: with the floor wired in, Carol's self-scoped fetch
      // returns the post-join entry only.
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const windowStart = new Date("2020-01-01T00:00:00.000Z");
      const floor = await selfScopedFloor(
        carol,
        scenario.carol.id,
        scenario.primaryTeam.id,
        [scenario.carol.id],
        windowStart,
      );
      const { data, error } = await carol
        .from("time_entries")
        .select("id")
        .gte("start_time", floor.toISOString())
        .in("id", [preJoinId, postJoinId]);
      expect(error).toBeNull();
      const ids = (data ?? []).map((r) => r.id);
      expect(ids).toContain(postJoinId);
      expect(ids).not.toContain(preJoinId);
    });

    it("does NOT clamp when memberFilter is null (owner-style cross-member view)", async () => {
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const windowStart = new Date("2020-01-01T00:00:00.000Z");
      const floor = await selfScopedFloor(
        carol,
        scenario.carol.id,
        scenario.primaryTeam.id,
        null,
        windowStart,
      );
      expect(floor).toEqual(windowStart);
    });

    it("does NOT clamp when no team is selected (cross-team self-scoped, phase-1 limitation)", async () => {
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const windowStart = new Date("2020-01-01T00:00:00.000Z");
      const floor = await selfScopedFloor(
        carol,
        scenario.carol.id,
        null,
        [scenario.carol.id],
        windowStart,
      );
      expect(floor).toEqual(windowStart);
    });
  });
});
