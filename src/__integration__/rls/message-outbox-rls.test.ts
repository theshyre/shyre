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
 * RLS regression suite for `message_outbox` + `message_outbox_events`.
 * QA audit C5 flagged these as untested, and the SECURITY MODEL is
 * notably tighter than other tables:
 *
 *   - SELECT is owner/admin only (per-team) — outbox rows carry the
 *     rendered invoice body_html / body_text (customer PII +
 *     monetary amounts) so the bar is "owner/admin who can already
 *     send" not "any team member."
 *
 *   - No INSERT or UPDATE policy for the `authenticated` role at
 *     all. All writes go through the messaging module via the
 *     admin client. RLS is the enforcement layer; the absence of a
 *     policy means non-service-role callers can't write.
 *
 *   - `message_outbox_events` SELECT mirrors the parent outbox
 *     row's owner/admin gate via an EXISTS subquery.
 */
describe("message_outbox RLS", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;
  let outboxId: string;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);

    // Seed an outbox row + event under the primary team. The
    // service-role admin client bypasses RLS so the setup works.
    const admin = adminClient();
    const { data, error } = await admin
      .from("message_outbox")
      .insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        related_kind: "invoice",
        related_id: null,
        from_email: "ap@example.test",
        to_email: "customer@example.test",
        subject: `${prefix} Invoice #001`,
        body_text: "Body",
        status: "sent",
      })
      .select("id")
      .single();
    if (error) throw error;
    outboxId = data.id as string;

    await admin.from("message_outbox_events").insert({
      outbox_id: outboxId,
      svix_id: `${prefix}-evt-1`,
      event_type: "delivered",
      payload: { delivered_at: new Date().toISOString() },
    });
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  // ──────────────────────────────────────────────────────────────
  // SELECT — owner / admin only (NOT plain members)
  // ──────────────────────────────────────────────────────────────

  it("primary-team owner can SELECT the outbox row", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("message_outbox")
      .select("id, subject")
      .eq("id", outboxId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("primary-team plain member CANNOT SELECT the outbox row — owner/admin only because body contains PII", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data } = await carol
      .from("message_outbox")
      .select("id")
      .eq("id", outboxId);
    expect(data).toHaveLength(0);
  });

  it("outsider in a different team CANNOT SELECT the outbox row", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data } = await eve
      .from("message_outbox")
      .select("id")
      .eq("id", outboxId);
    expect(data).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────
  // INSERT — no authenticated-role policy means EVERY auth user
  // is denied (only service_role / admin client can insert).
  // ──────────────────────────────────────────────────────────────

  it("primary-team owner CANNOT directly INSERT into message_outbox — all writes go through the admin client", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { error } = await alice.from("message_outbox").insert({
      team_id: scenario.primaryTeam.id,
      user_id: scenario.alice.id,
      related_kind: "invoice",
      from_email: "x@example.test",
      to_email: "y@example.test",
      subject: `${prefix} forged`,
      body_text: "x",
      status: "queued",
    });
    expect(error).not.toBeNull();
  });

  it("outsider CANNOT INSERT into message_outbox", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { error } = await eve.from("message_outbox").insert({
      team_id: scenario.primaryTeam.id,
      user_id: scenario.eve.id,
      related_kind: "invoice",
      from_email: "x@example.test",
      to_email: "y@example.test",
      subject: `${prefix} outsider-forged`,
      body_text: "x",
      status: "queued",
    });
    expect(error).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────
  // UPDATE — same shape: no policy means everyone is denied
  // (the daily-cap counter on team_email_config has its own SAL-025
  // trigger lock; this is the simpler all-fields-locked version).
  // ──────────────────────────────────────────────────────────────

  it("primary-team owner CANNOT directly UPDATE the outbox row — status flips happen via admin client", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data } = await alice
      .from("message_outbox")
      .update({ status: "failed" })
      .eq("id", outboxId)
      .select("id");
    expect(data ?? []).toHaveLength(0);

    // Verify status didn't flip.
    const admin = adminClient();
    const { data: row } = await admin
      .from("message_outbox")
      .select("status")
      .eq("id", outboxId)
      .single();
    expect(row?.status).toBe("sent");
  });

  // ──────────────────────────────────────────────────────────────
  // message_outbox_events — same gate inherited via EXISTS()
  // ──────────────────────────────────────────────────────────────

  it("primary-team owner can SELECT outbox events for their team's invoices", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data } = await alice
      .from("message_outbox_events")
      .select("id, event_type")
      .eq("outbox_id", outboxId);
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("primary-team plain member CANNOT SELECT outbox events (inherited owner/admin gate)", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data } = await carol
      .from("message_outbox_events")
      .select("id")
      .eq("outbox_id", outboxId);
    expect(data).toHaveLength(0);
  });

  it("outsider CANNOT SELECT outbox events", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data } = await eve
      .from("message_outbox_events")
      .select("id")
      .eq("outbox_id", outboxId);
    expect(data).toHaveLength(0);
  });
});
