import { describe, it, expect } from "vitest";
import { buildInvoiceActivity } from "./invoice-activity";

const baseInvoice = {
  id: "inv-1",
  status: "draft",
  created_at: "2026-04-19T12:05:00Z",
  created_by_user_id: "user-marcus",
  sent_at: null,
  paid_at: null,
  voided_at: null,
  imported_at: null,
  imported_from: null,
  currency: "USD",
  sent_to_email: null,
  sent_to_name: null,
};

describe("buildInvoiceActivity", () => {
  it("returns a single Created event for a brand-new draft", () => {
    const events = buildInvoiceActivity({
      invoice: baseInvoice,
      history: [],
      payments: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "created",
      occurredAt: "2026-04-19T12:05:00Z",
      actorUserId: "user-marcus",
    });
  });

  it("substitutes Imported for Created when imported_at is set", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        imported_at: "2026-04-19T08:00:00Z",
        imported_from: "harvest",
      },
      history: [],
      payments: [],
    });
    expect(events.map((e) => e.type)).toEqual(["imported"]);
    expect(events[0]?.occurredAt).toBe("2026-04-19T08:00:00Z");
  });

  it("Sent event includes sentTo when invoice has sent_to_email", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        sent_at: "2026-04-20T09:21:00Z",
        sent_to_email: "bandre@fdapproval.com",
        sent_to_name: "Bret Andre",
      },
      history: [],
      payments: [],
    });
    const sent = events.find((e) => e.type === "sent");
    expect(sent?.sentTo).toEqual({
      email: "bandre@fdapproval.com",
      name: "Bret Andre",
    });
  });

  it("Sent event omits sentTo when sent_to_email is null", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        sent_at: "2026-04-20T09:21:00Z",
      },
      history: [],
      payments: [],
    });
    const sent = events.find((e) => e.type === "sent");
    expect(sent?.sentTo).toBeUndefined();
  });

  it("emits Sent + Created in newest-first order with actor resolved from history", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        sent_at: "2026-04-20T09:21:00Z",
      },
      history: [
        {
          id: "h1",
          changed_at: "2026-04-20T09:21:00.500Z",
          changed_by_user_id: "user-bret",
          previous_state: { status: "draft" },
        },
      ],
      payments: [],
    });
    expect(events.map((e) => e.type)).toEqual(["sent", "created"]);
    expect(events[0]?.actorUserId).toBe("user-bret");
  });

  it("Payment events replace the Marked-paid event when payments exist", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        sent_at: "2026-04-20T09:21:00Z",
        paid_at: "2026-04-24T09:26:00Z",
      },
      history: [
        {
          id: "h1",
          changed_at: "2026-04-20T09:21:00Z",
          changed_by_user_id: "user-marcus",
          previous_state: { status: "draft" },
        },
        {
          id: "h2",
          changed_at: "2026-04-24T09:26:00Z",
          changed_by_user_id: "user-marcus",
          previous_state: { status: "sent" },
        },
      ],
      payments: [
        {
          id: "pay-1",
          amount: 352.35,
          currency: "USD",
          paid_on: "2026-04-24",
          paid_at: "2026-04-24T16:26:00Z",
          method: null,
          reference: null,
          created_at: "2026-04-30T22:00:00Z",
          created_by_user_id: "user-marcus",
        },
      ],
    });
    const types = events.map((e) => e.type);
    expect(types).toContain("payment");
    expect(types).not.toContain("paid");
    const payment = events.find((e) => e.type === "payment");
    expect(payment?.payment?.amount).toBe(352.35);
    expect(payment?.payment?.currency).toBe("USD");
    // Critical: the event timestamp is the actual paid time, NOT
    // the Shyre row's created_at (which would be the import time).
    expect(payment?.occurredAt).toBe("2026-04-24T16:26:00Z");
  });

  it("Payment event falls back to paid_on when paid_at is null (manual entry)", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        paid_at: "2026-04-24T09:26:00Z",
      },
      history: [],
      payments: [
        {
          id: "pay-2",
          amount: 100,
          currency: "USD",
          paid_on: "2026-04-24",
          paid_at: null,
          method: null,
          reference: null,
          created_at: "2026-04-30T22:00:00Z",
          created_by_user_id: "user-marcus",
        },
      ],
    });
    const payment = events.find((e) => e.type === "payment");
    expect(payment?.occurredAt).toBe("2026-04-24");
  });

  it("falls back to created_by_user_id for status events with no matching history row", () => {
    // The INSERT-time stamping path: an imported invoice lands at
    // status='paid', the BEFORE-INSERT trigger sets paid_at, but no
    // history row exists (history captures UPDATEs only). Without a
    // fallback the event renders as "Unknown user" — wrong, since
    // the importer is right there in created_by_user_id.
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        imported_at: "2026-04-19T08:00:00Z",
        imported_from: "harvest",
        paid_at: "2024-07-10T10:00:00Z",
        status: "paid",
        created_by_user_id: "user-marcus",
      },
      history: [],
      payments: [],
    });
    const paid = events.find((e) => e.type === "paid");
    expect(paid?.actorUserId).toBe("user-marcus");
  });

  it("emits Marked-paid as a fallback when paid_at is set but no payments rows exist", () => {
    // This is the imported-Harvest-paid case: Harvest reports the
    // invoice as paid, the import sets status='paid' which auto-stamps
    // paid_at, but Shyre has no per-payment row to surface.
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        imported_at: "2026-04-19T08:00:00Z",
        imported_from: "harvest",
        paid_at: "2026-04-19T08:00:00Z",
        status: "paid",
      },
      history: [],
      payments: [],
    });
    const types = events.map((e) => e.type);
    expect(types).toContain("paid");
    expect(types).toContain("imported");
  });

  it("emits an Updated event for non-status content changes", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        notes: "current notes",
      } as never,
      history: [
        {
          id: "h-update",
          changed_at: "2026-04-20T10:00:00Z",
          changed_by_user_id: "user-marcus",
          // notes changed; status is the same — pure content edit.
          previous_state: { status: "draft", notes: "old notes" },
        },
      ],
      payments: [],
    });
    expect(events.find((e) => e.type === "updated")).toBeDefined();
  });

  it("does NOT emit an Updated event for a pure status flip (already covered by Sent)", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        sent_at: "2026-04-20T09:21:00Z",
        status: "sent",
      },
      history: [
        {
          id: "h-flip",
          changed_at: "2026-04-20T09:21:00Z",
          changed_by_user_id: "user-marcus",
          // Only status differs — covered by the dedicated `sent` event.
          previous_state: { status: "draft" },
        },
      ],
      payments: [],
    });
    expect(events.filter((e) => e.type === "updated")).toHaveLength(0);
    expect(events.filter((e) => e.type === "sent")).toHaveLength(1);
  });

  it("orders events newest-first", () => {
    const events = buildInvoiceActivity({
      invoice: {
        ...baseInvoice,
        sent_at: "2026-04-20T09:21:00Z",
      },
      history: [],
      payments: [
        {
          id: "pay-1",
          amount: 100,
          currency: "USD",
          paid_on: "2026-04-25",
          paid_at: "2026-04-25T09:00:00Z",
          method: null,
          reference: null,
          created_at: "2026-04-25T09:00:00Z",
          created_by_user_id: "user-marcus",
        },
      ],
    });
    const tses = events.map((e) => new Date(e.occurredAt).getTime());
    for (let i = 1; i < tses.length; i++) {
      expect(tses[i - 1]).toBeGreaterThanOrEqual(tses[i] ?? 0);
    }
  });
});
