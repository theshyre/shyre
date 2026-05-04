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
  | "delivered"
  | "bounced"
  | "complained"
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
  /** Populated for every `sent` event. The summary fields
   *  (name + email) drive the headline; the structured `recipients`
   *  array surfaces multi-recipient sends without lossy joining.
   *  Legacy invoices with only `invoices.sent_at` set (Harvest
   *  imports) fall back to the singular email/name pair without
   *  recipients populated. */
  sentTo?: {
    email: string;
    name: string | null;
    recipients?: string[];
    /** SHA-256 of the PDF attachment dispatched on this send.
     *  Stored on every outbox row; surfaced in the activity log
     *  so a bookkeeper can prove which version of the PDF a
     *  customer received. */
    attachmentSha256?: string | null;
  };
  /** Populated for `delivered` / `bounced` / `complained` events.
   *  `detail` carries the bounce reason or complaint subType when
   *  Resend's payload includes one. */
  webhook?: {
    detail: string | null;
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
    /** Most-recent send recipient — populated by importers and the
     *  in-app Send action. Null until the invoice has been sent. */
    sent_to_email: string | null;
    sent_to_name: string | null;
  };
  /** One row per actual send through the messaging outbox. Each
   *  becomes a distinct `sent` event in the activity log so re-sends
   *  show as their own entries with timestamps + recipients +
   *  attachment SHA. Legacy invoices (Harvest imports) have no
   *  outbox rows; they fall back to the single sent event built
   *  from `invoices.sent_at`. */
  outboxSends?: Array<{
    id: string;
    sent_at: string | null;
    user_id: string | null;
    to_emails: string[];
    attachment_pdf_sha256: string | null;
  }>;
  /** Webhook events Resend has delivered for any of this invoice's
   *  outbox rows. Surface delivered / bounced / complained as their
   *  own activity events so the bookkeeper has in-app evidence
   *  matching what Resend's dashboard would show. */
  webhookEvents?: Array<{
    id: string;
    outbox_id: string;
    event_type: string;
    received_at: string;
    /** Bounce-reason or complaint detail extracted from the payload
     *  for surfacing under the row. Null when not present. */
    detail: string | null;
  }>;
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
    /** Calendar date the payment was credited to AR. Always set. */
    paid_on: string;
    /** Actual time-of-day the payment was recorded. Set on imports
     *  from sources that track it (Harvest); null on manual entries
     *  where we only know the date. */
    paid_at: string | null;
    method: string | null;
    reference: string | null;
    /** When the Shyre row was inserted — i.e. import time, NOT the
     *  payment time. Don't surface this in the UI. */
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
  const { invoice, history, payments, outboxSends, webhookEvents } = input;
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

  // Sent events. Two sources:
  //
  //   1. Outbox rows — one per actual send through the messaging
  //      module. Each becomes its own activity event so re-sends
  //      (deliberate or panic re-sends after a customer claims
  //      non-receipt) all show with their own timestamp, recipients,
  //      and PDF SHA-256. Bookkeeper-grade audit trail.
  //
  //   2. Legacy `invoices.sent_at` — Harvest imports never wrote
  //      outbox rows; that timestamp is the only signal. Used only
  //      when no outbox rows exist for the invoice.
  //
  // The two paths are mutually exclusive: outbox rows always win
  // when present, so an invoice that was Harvest-imported and then
  // re-sent through Shyre's send action shows the Shyre sends
  // (which carry richer detail) and treats the imported sent_at as
  // the import event, not a separate "sent" entry.
  const outboxSendsWithTime = (outboxSends ?? []).filter(
    (s): s is typeof s & { sent_at: string } => Boolean(s.sent_at),
  );
  if (outboxSendsWithTime.length > 0) {
    for (const send of outboxSendsWithTime) {
      events.push({
        id: `sent-${send.id}`,
        type: "sent",
        occurredAt: send.sent_at,
        actorUserId:
          send.user_id ??
          findActorAt(send.sent_at, history) ??
          fallbackActor,
        sentTo: {
          email:
            send.to_emails.length > 0
              ? send.to_emails.join(", ")
              : (invoice.sent_to_email ?? ""),
          // First-send pairs with the invoice-level name; later
          // sends don't have a per-row name on the outbox row, so
          // fall through to the invoice-level snapshot.
          name: invoice.sent_to_name,
          recipients:
            send.to_emails.length > 0 ? send.to_emails : undefined,
          attachmentSha256: send.attachment_pdf_sha256,
        },
      });
    }
  } else if (invoice.sent_at) {
    events.push({
      id: `sent-${invoice.id}`,
      type: "sent",
      occurredAt: invoice.sent_at,
      actorUserId: findActorAt(invoice.sent_at, history) ?? fallbackActor,
      sentTo: invoice.sent_to_email
        ? { email: invoice.sent_to_email, name: invoice.sent_to_name }
        : undefined,
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

  // Webhook events (delivered / bounced / complained). Each gets
  // its own activity row pointing at when Resend's worker reported
  // back. Only the three event types we surface as user-meaningful
  // are emitted; engagement events (opened / clicked) reach this
  // table for Phase 2 use but aren't rendered yet.
  for (const w of webhookEvents ?? []) {
    const type: InvoiceActivityEventType | null =
      w.event_type === "email.delivered"
        ? "delivered"
        : w.event_type === "email.bounced"
          ? "bounced"
          : w.event_type === "email.complained"
            ? "complained"
            : null;
    if (!type) continue;
    events.push({
      id: `webhook-${w.id}`,
      type,
      occurredAt: w.received_at,
      // Webhook events have no human actor — Resend wrote them.
      // The activity log row renders the icon directly when no
      // profile resolves, which is the right shape here.
      actorUserId: null,
      webhook: { detail: w.detail },
    });
  }

  for (const p of payments) {
    // Prefer the actual paid timestamp (Harvest's recorded-at) over
    // the Shyre row's created_at, which only tells us when the import
    // ran. Falls back to paid_on at midnight in the viewer's TZ
    // (the Date constructor does the right thing with YYYY-MM-DD on
    // the client) when neither source provides a real timestamp —
    // e.g. a hand-entered payment where the user only knew the day.
    const occurredAt = p.paid_at ?? p.paid_on;
    events.push({
      id: `payment-${p.id}`,
      type: "payment",
      occurredAt,
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
