/**
 * Build the chronological activity timeline for an invoice from
 * the data already captured in the schema:
 *
 *   - `invoices` row (created_at + created_by, sent_at, paid_at,
 *     voided_at, imported_at + import_run_id)
 *   - `invoices_history` (every UPDATE/DELETE with previous_state +
 *     changed_by + changed_at; written by a SECURITY DEFINER trigger)
 *   - `invoice_payments` (one row per recorded payment with
 *     amount + method + reference + created_by)
 *
 * No new tables, no new triggers — all the events the UI needs are
 * already in the database. We just glue them into one ordered list.
 *
 * Actor resolution for status-flip events: the timestamp columns
 * (sent_at / paid_at / voided_at) are auto-stamped by a BEFORE-UPDATE
 * trigger on the same row, so the matching `invoices_history` row
 * fires within the same statement and shares the changed_at clock.
 * We pair them by "history row whose changed_at is within a few
 * seconds of the timestamp" — exact match isn't reliable because
 * Postgres now() inside the trigger and the history insert can
 * disagree by microseconds depending on which trigger ran first.
 *
 * If no history actor can be resolved (e.g. the row was created
 * already at status='sent' so no update history exists), we fall
 * back to created_by_user_id, which is at least the right user for
 * imports and bulk-create paths.
 */

export type InvoiceActivityEventType =
  | "imported"
  | "created"
  | "sent"
  | "paid"
  | "voided"
  | "payment"
  | "updated";

export interface InvoiceActivityEvent {
  /** Stable key for React lists; safe to use as the row key. */
  id: string;
  type: InvoiceActivityEventType;
  occurredAt: string;
  actorUserId: string | null;
  /** Populated only for `payment` events. */
  payment?: {
    amount: number;
    currency: string;
    method: string | null;
    reference: string | null;
    paidOn: string;
  };
}

export interface InvoiceActivityInput {
  invoice: {
    id: string;
    status: string | null;
    created_at: string | null;
    created_by_user_id: string | null;
    sent_at: string | null;
    paid_at: string | null;
    voided_at: string | null;
    imported_at: string | null;
    imported_from: string | null;
    currency: string | null;
  };
  history: Array<{
    id: string;
    changed_at: string;
    changed_by_user_id: string | null;
    /** Full row state pre-change as JSONB. */
    previous_state: Record<string, unknown>;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    currency: string | null;
    paid_on: string;
    method: string | null;
    reference: string | null;
    created_at: string;
    created_by_user_id: string | null;
  }>;
}

/**
 * Window (ms) for pairing a `*_at` column flip to its `invoices_history`
 * row. The trigger that stamps the timestamp and the trigger that
 * writes the history row both run inside the same UPDATE statement
 * but sample `now()` independently — observed drift is sub-millisecond
 * in practice; 5 seconds is a generous safety margin without risking
 * mis-pairing two different mutations.
 */
const ACTOR_PAIR_WINDOW_MS = 5_000;

function findActorAt(
  ts: string | null,
  history: InvoiceActivityInput["history"],
): string | null {
  if (!ts) return null;
  const target = new Date(ts).getTime();
  if (Number.isNaN(target)) return null;
  let best: { actor: string | null; delta: number } | null = null;
  for (const h of history) {
    const t = new Date(h.changed_at).getTime();
    if (Number.isNaN(t)) continue;
    const delta = Math.abs(t - target);
    if (delta > ACTOR_PAIR_WINDOW_MS) continue;
    if (best === null || delta < best.delta) {
      best = { actor: h.changed_by_user_id, delta };
    }
  }
  return best?.actor ?? null;
}

/**
 * Did this history row represent a "real" content edit, as opposed
 * to a pure status flip / timestamp stamp that we already surface
 * via the dedicated sent/paid/voided events?
 *
 * Compares the previous_state JSONB to itself with status &
 * timestamp fields stripped — if anything else differs from the
 * post-change state, treat it as a content edit. Without this filter
 * a "Mark sent" click would render as both "Sent" AND "Updated",
 * which is the noise Harvest's UI is also careful to avoid.
 */
function looksLikeContentEdit(
  prev: Record<string, unknown>,
  current: InvoiceActivityInput["invoice"],
): boolean {
  const ignored = new Set([
    "status",
    "sent_at",
    "paid_at",
    "voided_at",
    "updated_at",
    "updated_by_user_id",
  ]);
  for (const [key, value] of Object.entries(prev)) {
    if (ignored.has(key)) continue;
    const currentValue = (current as unknown as Record<string, unknown>)[key];
    if (currentValue === undefined) continue;
    // JSON-equality is enough for our shape (no nested objects we
    // care about beyond top-level columns; address fields are stored
    // serialized as a single JSON string column).
    if (JSON.stringify(value) !== JSON.stringify(currentValue)) {
      return true;
    }
  }
  return false;
}

export function buildInvoiceActivity(
  input: InvoiceActivityInput,
): InvoiceActivityEvent[] {
  const { invoice, history, payments } = input;
  const events: InvoiceActivityEvent[] = [];

  // Imported / created — mutually exclusive in practice. An imported
  // row gets its created_at and imported_at set together, but the
  // user-meaningful event is "Imported", not "Created (by the
  // import bot)".
  if (invoice.imported_at && invoice.imported_from) {
    events.push({
      id: `imported-${invoice.id}`,
      type: "imported",
      occurredAt: invoice.imported_at,
      actorUserId: invoice.created_by_user_id,
    });
  } else if (invoice.created_at) {
    events.push({
      id: `created-${invoice.id}`,
      type: "created",
      occurredAt: invoice.created_at,
      actorUserId: invoice.created_by_user_id,
    });
  }

  // For status-flip timestamps, prefer the actor recorded in
  // invoices_history. If no match exists, the timestamp was stamped
  // on INSERT (no history row exists for inserts — the trigger only
  // captures UPDATEs), so the right actor is the row's creator.
  // Without this fallback an imported-paid invoice renders "Marked
  // as paid by Unknown user" — confusing for an importer who knows
  // they ran the import.
  const fallbackActor = invoice.created_by_user_id;

  if (invoice.sent_at) {
    events.push({
      id: `sent-${invoice.id}`,
      type: "sent",
      occurredAt: invoice.sent_at,
      actorUserId: findActorAt(invoice.sent_at, history) ?? fallbackActor,
    });
  }

  // Mark-paid as an event only when there are no payment rows. With
  // payment rows the `paid` status flip is implicit (sum of payments
  // hit the total), and the payment events themselves carry the user
  // signal — duplicating them as "Marked paid" is noise.
  if (invoice.paid_at && payments.length === 0) {
    events.push({
      id: `paid-${invoice.id}`,
      type: "paid",
      occurredAt: invoice.paid_at,
      actorUserId: findActorAt(invoice.paid_at, history) ?? fallbackActor,
    });
  }

  if (invoice.voided_at) {
    events.push({
      id: `voided-${invoice.id}`,
      type: "voided",
      occurredAt: invoice.voided_at,
      actorUserId: findActorAt(invoice.voided_at, history) ?? fallbackActor,
    });
  }

  for (const p of payments) {
    events.push({
      id: `payment-${p.id}`,
      type: "payment",
      occurredAt: p.created_at,
      actorUserId: p.created_by_user_id,
      payment: {
        amount: Number(p.amount),
        currency: p.currency ?? invoice.currency ?? "USD",
        method: p.method,
        reference: p.reference,
        paidOn: p.paid_on,
      },
    });
  }

  // Generic "updated" events — anything in invoices_history that
  // wasn't already accounted for by a status flip.
  for (const h of history) {
    if (!looksLikeContentEdit(h.previous_state, invoice)) continue;
    events.push({
      id: `updated-${h.id}`,
      type: "updated",
      occurredAt: h.changed_at,
      actorUserId: h.changed_by_user_id,
    });
  }

  // Newest first. Stable tiebreaker by id so re-renders don't reorder
  // simultaneous events.
  events.sort((a, b) => {
    const ta = new Date(a.occurredAt).getTime();
    const tb = new Date(b.occurredAt).getTime();
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return events;
}
