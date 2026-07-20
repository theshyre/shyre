import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { makeRunPrefix } from "../helpers/prefix";
import { cleanupPrefix } from "../helpers/cleanup";
import { createAuthedClient } from "../helpers/authed-client";
import { adminClient } from "../helpers/admin";
import {
  twoTeamSharingScenario,
  TwoTeamSharingScenario,
} from "../helpers/fixtures";
import { createTestProject } from "../helpers/customers";

/**
 * Period-lock guards on time_entries / expenses / invoices /
 * invoice_line_items.
 *
 * Migrations under test:
 *   - 20260428030840_team_period_locks.sql
 *   - 20260428031721_period_lock_invoice_completeness.sql
 *
 * We seed a primary team via the standard fixture, lock through a
 * fixed past date, then probe the four guarded surfaces. The admin
 * client is used wherever the assertion is "this raises" so we
 * isolate the trigger from any RLS-side blocker — the trigger is
 * the boundary we want to verify.
 */
describe("period locks", () => {
  let prefix: string;
  let scenario: TwoTeamSharingScenario;
  /** Lock through this date for the primary team. Earlier writes
   *  fail, later writes pass. */
  const LOCK_DATE = "2026-01-31";
  /** A date inside the lock window (≤ LOCK_DATE). */
  const INSIDE = "2026-01-15";
  /** A date outside the lock window (> LOCK_DATE). */
  const OUTSIDE = "2026-02-15";

  beforeAll(async () => {
    prefix = makeRunPrefix();
    scenario = await twoTeamSharingScenario(prefix);
  });

  afterAll(async () => {
    await cleanupPrefix(prefix);
  });

  beforeEach(async () => {
    // Reset lock state between cases so order doesn't matter.
    await adminClient()
      .from("team_period_locks")
      .delete()
      .eq("team_id", scenario.primaryTeam.id);
  });

  async function lockPrimary(): Promise<void> {
    const { error } = await adminClient().from("team_period_locks").insert({
      team_id: scenario.primaryTeam.id,
      period_end: LOCK_DATE,
      locked_by_user_id: scenario.alice.id,
    });
    if (error) throw new Error(`lock setup failed: ${error.message}`);
  }

  // ============================================================
  // time_entries
  // ============================================================

  describe("time_entries", () => {
    it("blocks INSERT whose start_time falls inside the lock", async () => {
      await lockPrimary();
      const start = `${INSIDE}T09:00:00Z`;
      const end = `${INSIDE}T10:00:00Z`;
      const { error } = await adminClient().from("time_entries").insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        description: `${prefix}locked-entry`,
        start_time: start,
        end_time: end,
      });
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });

    it("allows INSERT whose start_time falls outside the lock", async () => {
      await lockPrimary();
      const start = `${OUTSIDE}T09:00:00Z`;
      const end = `${OUTSIDE}T10:00:00Z`;
      const { error } = await adminClient().from("time_entries").insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        project_id: scenario.project.id,
        description: `${prefix}unlocked-entry`,
        start_time: start,
        end_time: end,
      });
      expect(error).toBeNull();
    });

    it("blocks UPDATE that moves an entry INTO a locked period", async () => {
      // Seed an entry outside the lock first, then lock, then try to
      // pull the entry back into the locked window.
      const outsideStart = `${OUTSIDE}T09:00:00Z`;
      const outsideEnd = `${OUTSIDE}T10:00:00Z`;
      const { data: entry, error: insertErr } = await adminClient()
        .from("time_entries")
        .insert({
          team_id: scenario.primaryTeam.id,
          user_id: scenario.alice.id,
          project_id: scenario.project.id,
          description: `${prefix}movable-entry`,
          start_time: outsideStart,
          end_time: outsideEnd,
        })
        .select("id")
        .single();
      expect(insertErr).toBeNull();

      await lockPrimary();

      const { error: updateErr } = await adminClient()
        .from("time_entries")
        .update({
          start_time: `${INSIDE}T09:00:00Z`,
          end_time: `${INSIDE}T10:00:00Z`,
        })
        .eq("id", entry!.id);
      expect(updateErr?.message ?? "").toMatch(/Period closed/i);
    });
  });

  // ============================================================
  // expenses
  // ============================================================

  describe("expenses", () => {
    it("blocks INSERT whose incurred_on is inside the lock", async () => {
      await lockPrimary();
      const { error } = await adminClient().from("expenses").insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        incurred_on: INSIDE,
        amount: 50,
        currency: "USD",
        category: "office",
        billable: false,
      });
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });

    it("allows INSERT whose incurred_on is outside the lock", async () => {
      await lockPrimary();
      const { error } = await adminClient().from("expenses").insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        incurred_on: OUTSIDE,
        amount: 50,
        currency: "USD",
        category: "office",
        billable: false,
      });
      expect(error).toBeNull();
    });
  });

  // ============================================================
  // invoices — money fields blocked, status-only allowed
  // ============================================================

  describe("invoices", () => {
    async function seedLockedInvoice(): Promise<string> {
      // Seed BEFORE the lock so the row exists; then lock.
      const { data: inv, error: insertErr } = await adminClient()
        .from("invoices")
        .insert({
          team_id: scenario.primaryTeam.id,
          customer_id: scenario.client.id,
          invoice_number: `${prefix}INV-1`,
          status: "sent",
          issued_date: INSIDE,
          subtotal: 1000,
          tax_rate: 0,
          tax_amount: 0,
          total: 1000,
          currency: "USD",
        })
        .select("id")
        .single();
      if (insertErr || !inv) throw new Error(`seed: ${insertErr?.message}`);
      await lockPrimary();
      return inv.id as string;
    }

    it("blocks INSERT whose issued_date is inside the lock", async () => {
      await lockPrimary();
      const { error } = await adminClient().from("invoices").insert({
        team_id: scenario.primaryTeam.id,
        customer_id: scenario.client.id,
        invoice_number: `${prefix}INV-blocked`,
        status: "sent",
        issued_date: INSIDE,
        subtotal: 100,
        tax_rate: 0,
        tax_amount: 0,
        total: 100,
        currency: "USD",
      });
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });

    it("allows status-only UPDATE on a locked invoice (sent → paid)", async () => {
      const id = await seedLockedInvoice();
      const { error } = await adminClient()
        .from("invoices")
        .update({ status: "paid" })
        .eq("id", id);
      expect(error).toBeNull();
    });

    it("blocks UPDATE that changes a money field on a locked invoice", async () => {
      const id = await seedLockedInvoice();
      const { error } = await adminClient()
        .from("invoices")
        .update({ subtotal: 9999, total: 9999 })
        .eq("id", id);
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });

    it("blocks UPDATE that flips currency on a locked invoice", async () => {
      // SAL-012/013 follow-up: currency was missing from the original
      // status-only allowlist (20260428030840). Migration
      // 20260428031721 closed that hole.
      const id = await seedLockedInvoice();
      const { error } = await adminClient()
        .from("invoices")
        .update({ currency: "EUR" })
        .eq("id", id);
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });
  });

  // ============================================================
  // invoice_line_items — protected via parent invoice's issued_date
  // ============================================================

  describe("invoice_line_items", () => {
    async function seedLockedInvoiceWithLine(): Promise<{
      invoiceId: string;
      lineId: string;
    }> {
      const { data: inv, error: invErr } = await adminClient()
        .from("invoices")
        .insert({
          team_id: scenario.primaryTeam.id,
          customer_id: scenario.client.id,
          invoice_number: `${prefix}INV-li`,
          status: "sent",
          issued_date: INSIDE,
          subtotal: 1000,
          tax_rate: 0,
          tax_amount: 0,
          total: 1000,
          currency: "USD",
        })
        .select("id")
        .single();
      if (invErr || !inv) throw new Error(`inv seed: ${invErr?.message}`);

      const { data: line, error: lineErr } = await adminClient()
        .from("invoice_line_items")
        .insert({
          invoice_id: inv.id,
          description: `${prefix}original`,
          quantity: 10,
          unit_price: 100,
          amount: 1000,
        })
        .select("id")
        .single();
      if (lineErr || !line) throw new Error(`line seed: ${lineErr?.message}`);

      await lockPrimary();
      return { invoiceId: inv.id as string, lineId: line.id as string };
    }

    it("blocks UPDATE on a line item whose parent invoice is locked", async () => {
      const { lineId } = await seedLockedInvoiceWithLine();
      const { error } = await adminClient()
        .from("invoice_line_items")
        .update({ amount: 5000, unit_price: 500 })
        .eq("id", lineId);
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });

    it("blocks INSERT of a new line item on a locked invoice", async () => {
      const { invoiceId } = await seedLockedInvoiceWithLine();
      const { error } = await adminClient()
        .from("invoice_line_items")
        .insert({
          invoice_id: invoiceId,
          description: `${prefix}sneaky-add`,
          quantity: 1,
          unit_price: 9999,
          amount: 9999,
        });
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });

    it("blocks DELETE of a line item on a locked invoice", async () => {
      const { lineId } = await seedLockedInvoiceWithLine();
      const { error } = await adminClient()
        .from("invoice_line_items")
        .delete()
        .eq("id", lineId);
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });
  });

  // ============================================================
  // RLS on team_period_locks itself
  // ============================================================

  describe("team_period_locks RLS", () => {
    it("plain member CANNOT SELECT locks for their team", async () => {
      await lockPrimary();
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const { data, error } = await carol
        .from("team_period_locks")
        .select("period_end")
        .eq("team_id", scenario.primaryTeam.id);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("owner CAN SELECT locks for their team", async () => {
      await lockPrimary();
      const alice = await createAuthedClient(
        scenario.alice.email,
        scenario.alice.password,
      );
      const { data, error } = await alice
        .from("team_period_locks")
        .select("period_end")
        .eq("team_id", scenario.primaryTeam.id);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);
    });

    it("plain member CANNOT INSERT a lock", async () => {
      const carol = await createAuthedClient(
        scenario.carol.email,
        scenario.carol.password,
      );
      const { error } = await carol.from("team_period_locks").insert({
        team_id: scenario.primaryTeam.id,
        period_end: "2026-02-28",
      });
      expect(error).not.toBeNull();
    });
  });

  // ============================================================
  // invoice_payments (guard + history added 20260720100000)
  // ============================================================

  describe("invoice_payments", () => {
    /** Seed an invoice (issued INSIDE) + optionally a payment, all
     *  BEFORE any lock exists, and return their ids. */
    async function seedInvoice(label: string): Promise<string> {
      const { data: inv, error } = await adminClient()
        .from("invoices")
        .insert({
          team_id: scenario.primaryTeam.id,
          customer_id: scenario.client.id,
          invoice_number: `${prefix}INV-pay-${label}`,
          status: "sent",
          issued_date: INSIDE,
          subtotal: 500,
          tax_rate: 0,
          tax_amount: 0,
          total: 500,
          currency: "USD",
        })
        .select("id")
        .single();
      if (error || !inv) throw new Error(`seed invoice: ${error?.message}`);
      return inv.id as string;
    }

    async function seedPayment(
      invoiceId: string,
      paidOn: string,
    ): Promise<string> {
      const { data, error } = await adminClient()
        .from("invoice_payments")
        .insert({ invoice_id: invoiceId, amount: 100, paid_on: paidOn })
        .select("id")
        .single();
      if (error || !data) throw new Error(`seed payment: ${error?.message}`);
      return data.id as string;
    }

    it("blocks INSERT whose paid_on falls inside the lock", async () => {
      const invoiceId = await seedInvoice("ins");
      await lockPrimary();
      const { error } = await adminClient()
        .from("invoice_payments")
        .insert({ invoice_id: invoiceId, amount: 100, paid_on: INSIDE });
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });

    it("allows INSERT whose paid_on falls after the lock", async () => {
      const invoiceId = await seedInvoice("ins-ok");
      await lockPrimary();
      const { error } = await adminClient()
        .from("invoice_payments")
        .insert({ invoice_id: invoiceId, amount: 100, paid_on: OUTSIDE });
      expect(error).toBeNull();
    });

    it("blocks UPDATE and DELETE of a payment dated inside the lock", async () => {
      const invoiceId = await seedInvoice("upd");
      const paymentId = await seedPayment(invoiceId, INSIDE);
      await lockPrimary();

      const { error: updErr } = await adminClient()
        .from("invoice_payments")
        .update({ amount: 250 })
        .eq("id", paymentId);
      expect(updErr?.message ?? "").toMatch(/Period closed/i);

      const { error: delErr } = await adminClient()
        .from("invoice_payments")
        .delete()
        .eq("id", paymentId);
      expect(delErr?.message ?? "").toMatch(/Period closed/i);
    });

    it("blocks backdating an unlocked payment INTO the lock", async () => {
      const invoiceId = await seedInvoice("backdate");
      const paymentId = await seedPayment(invoiceId, OUTSIDE);
      await lockPrimary();
      const { error } = await adminClient()
        .from("invoice_payments")
        .update({ paid_on: INSIDE })
        .eq("id", paymentId);
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });

    it("UPDATE and DELETE write append-only history rows with the previous state", async () => {
      const invoiceId = await seedInvoice("hist");
      const paymentId = await seedPayment(invoiceId, OUTSIDE);

      await adminClient()
        .from("invoice_payments")
        .update({ amount: 175 })
        .eq("id", paymentId);
      await adminClient()
        .from("invoice_payments")
        .delete()
        .eq("id", paymentId);

      const { data: history, error } = await adminClient()
        .from("invoice_payments_history")
        .select("operation, previous_state")
        .eq("payment_id", paymentId)
        .order("changed_at", { ascending: true });
      expect(error).toBeNull();
      const ops = (history ?? []).map((h) => h.operation);
      expect(ops).toEqual(["UPDATE", "DELETE"]);
      const first = (history ?? [])[0]?.previous_state as {
        amount: string | number;
      };
      // The UPDATE's snapshot carries the pre-change amount.
      expect(Number(first?.amount)).toBe(100);
    });
  });

  // ============================================================
  // internal projects (customer_id NULL) — bypass fixed 20260720100000
  // ============================================================

  describe("time_entries on internal projects", () => {
    it("blocks INSERT inside the lock even when the project has no customer", async () => {
      const internal = await createTestProject(
        prefix,
        scenario.primaryTeam.id,
        null,
        scenario.alice.id,
        "internal-lock-probe",
      );
      await lockPrimary();
      const { error } = await adminClient().from("time_entries").insert({
        team_id: scenario.primaryTeam.id,
        user_id: scenario.alice.id,
        project_id: internal.id,
        description: `${prefix}internal-locked-entry`,
        start_time: `${INSIDE}T09:00:00Z`,
        end_time: `${INSIDE}T10:00:00Z`,
      });
      // Pre-fix, the guard resolved the team via projects → customers and
      // silently skipped customer-less projects entirely.
      expect(error?.message ?? "").toMatch(/Period closed/i);
    });
  });
});
