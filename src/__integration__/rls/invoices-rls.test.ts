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
 * RLS regression suite for `invoices` (+ `invoice_line_items` +
 * `invoice_payments`). QA audit C5 flagged these as untested
 * tables that carry team financial data and customer-PII (the
 * `sent_to_email` column). A bug in the SELECT policy that leaked
 * one team's invoices to another would not be caught.
 *
 * Sharing model under test:
 *   - Alice owns primaryTeam
 *   - Carol is a member of primaryTeam
 *   - Bob owns participatingTeam (which optionally has a customer
 *     share for the customer)
 *   - Eve owns outsiderTeam (no relationship)
 *
 * The invoice belongs to primaryTeam.customer; we then check who
 * can SELECT, who can INSERT, who can UPDATE the status.
 */
describe("invoices RLS", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;
  let invoiceId: string;

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);

    // Seed an invoice owned by primaryTeam, billed to its customer.
    // SECURITY DEFINER + service-role write bypasses RLS so the
    // setup is deterministic.
    const admin = adminClient();
    const { data, error } = await admin
      .from("invoices")
      .insert({
        team_id: scenario.primaryTeam.id,
        customer_id: scenario.client.id,
        user_id: scenario.alice.id,
        invoice_number: `${prefix}-INV-001`,
        status: "draft",
        subtotal: 1000,
        tax_rate: 0,
        tax_amount: 0,
        total: 1000,
        currency: "USD",
      })
      .select("id")
      .single();
    if (error) throw error;
    invoiceId = data.id as string;
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  // ──────────────────────────────────────────────────────────────
  // SELECT
  // ──────────────────────────────────────────────────────────────

  it("primary-team owner can SELECT the invoice", async () => {
    const alice = await createAuthedClient(
      scenario.alice.email,
      scenario.alice.password,
    );
    const { data, error } = await alice
      .from("invoices")
      .select("id, status")
      .eq("id", invoiceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("primary-team member (non-owner) can SELECT the invoice — team members see their team's invoices", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data } = await carol
      .from("invoices")
      .select("id")
      .eq("id", invoiceId);
    expect(data).toHaveLength(1);
  });

  it("outsider in a different team cannot SELECT the invoice", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data, error } = await eve
      .from("invoices")
      .select("id")
      .eq("id", invoiceId);
    // RLS denies → empty array, no error.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("participating-team owner WITHOUT customer-share cannot SELECT the invoice", async () => {
    const bob = await createAuthedClient(
      scenario.bob.email,
      scenario.bob.password,
    );
    const { data } = await bob
      .from("invoices")
      .select("id")
      .eq("id", invoiceId);
    expect(data).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────
  // INSERT
  // ──────────────────────────────────────────────────────────────

  it("outsider cannot INSERT an invoice on the primary team", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { error } = await eve.from("invoices").insert({
      team_id: scenario.primaryTeam.id,
      customer_id: scenario.client.id,
      user_id: scenario.eve.id,
      invoice_number: `${prefix}-INV-FORGED`,
      status: "draft",
      subtotal: 0,
      tax_rate: 0,
      tax_amount: 0,
      total: 0,
      currency: "USD",
    });
    expect(error).not.toBeNull();
  });

  it("primary-team member (non-owner) cannot INSERT — invoice creation is owner/admin only", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { error } = await carol.from("invoices").insert({
      team_id: scenario.primaryTeam.id,
      customer_id: scenario.client.id,
      user_id: scenario.carol.id,
      invoice_number: `${prefix}-INV-MEMBER`,
      status: "draft",
      subtotal: 0,
      tax_rate: 0,
      tax_amount: 0,
      total: 0,
      currency: "USD",
    });
    expect(error).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────
  // UPDATE
  // ──────────────────────────────────────────────────────────────

  it("primary-team member cannot UPDATE invoice status", async () => {
    const carol = await createAuthedClient(
      scenario.carol.email,
      scenario.carol.password,
    );
    const { data, error } = await carol
      .from("invoices")
      .update({ status: "paid" })
      .eq("id", invoiceId)
      .select("id");
    // Either an error OR an empty result set — both are RLS denial
    // shapes. We accept either.
    if (!error) {
      expect(data).toHaveLength(0);
    }

    // Verify status didn't actually change.
    const admin = adminClient();
    const { data: row } = await admin
      .from("invoices")
      .select("status")
      .eq("id", invoiceId)
      .single();
    expect(row?.status).toBe("draft");
  });

  it("outsider cannot UPDATE the invoice", async () => {
    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data } = await eve
      .from("invoices")
      .update({ status: "paid" })
      .eq("id", invoiceId)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────
  // invoice_line_items + invoice_payments — same scoping
  // ──────────────────────────────────────────────────────────────

  it("invoice_line_items: outsider cannot SELECT lines for an invoice they can't see", async () => {
    const admin = adminClient();
    await admin.from("invoice_line_items").insert({
      invoice_id: invoiceId,
      description: "Test line",
      quantity: 1,
      unit_price: 1000,
      amount: 1000,
    });

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data } = await eve
      .from("invoice_line_items")
      .select("id")
      .eq("invoice_id", invoiceId);
    expect(data).toHaveLength(0);
  });

  it("invoice_payments: outsider cannot SELECT payments for an invoice they can't see", async () => {
    const admin = adminClient();
    await admin.from("invoice_payments").insert({
      invoice_id: invoiceId,
      amount: 100,
      currency: "USD",
      paid_on: "2026-04-15",
    });

    const eve = await createAuthedClient(
      scenario.eve.email,
      scenario.eve.password,
    );
    const { data } = await eve
      .from("invoice_payments")
      .select("id")
      .eq("invoice_id", invoiceId);
    expect(data).toHaveLength(0);
  });
});
