import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { FileText, Download } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import { InvoiceActivity } from "./invoice-activity";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("invoice_number")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) {
    const t = await getTranslations("invoices");
    return { title: t("title") };
  }
  return { title: invoice.invoice_number as string };
}
import { formatDate, Avatar, resolveAvatarUrl } from "@theshyre/ui";
import { formatCurrency } from "@/lib/invoice-utils";
import {
  groupEntriesIntoLineItems,
  type EntryCandidate,
} from "@/lib/invoice-grouping";
import {
  deserializeAddress,
  formatAddressMultiLine,
} from "@/lib/schemas/address";
import { InvoiceActions } from "./invoice-actions";
import { InvoicePdfButton } from "./invoice-pdf-button";
import { SendInvoiceButton } from "./send-invoice-button";
import { InvoiceStatusBadge } from "../invoice-status-badge";
/**
 * Drop the country line from a multi-line formatted address unless
 * the caller wants to show it. `formatAddressMultiLine` returns
 * `[street, "city, state zip", country]` with country at the tail
 * when present. The country line reads as noise on domestic
 * invoices, so it's hidden by default; the per-address toggles
 * (`team_settings.show_country_on_invoice` and
 * `customers.show_country_on_invoice`) re-enable it. Mirrors the
 * PDF helper of the same shape.
 */
function trimCountryLines(lines: string[], showCountry: boolean): string[] {
  if (showCountry) return lines;
  // Trim only when there are 2+ lines — single-line legacy
  // plain-text addresses must survive intact. With 2+ lines, the
  // country (when present) is the last line and never has a comma,
  // while the city/state/zip line always does — so a comma-less
  // last line is the country to drop.
  if (lines.length < 2) return lines;
  const last = lines[lines.length - 1];
  if (last && !last.includes(",")) return lines.slice(0, -1);
  return lines;
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTranslations("invoices");

  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "*, customers(id, name, email, address, show_country_on_invoice)",
    )
    .eq("id", id)
    .single();

  if (!invoice) notFound();

  // Line items, history, payments, and entry-authors-on-this-invoice
  // are independent reads — fire them in parallel rather than
  // waterfall. RLS scopes each one separately so a viewer who can't
  // see history (non-owner/admin) gets [] from that query and the
  // activity section just hides.
  //
  // Send-related data (recipient contacts, email config, domain
  // verification, template) used to be fetched here too; that work
  // moved to /invoices/[id]/send via loadInvoiceSendBundle when the
  // modal was promoted to its own route. The button on this page
  // is now just a Link → /send, demoted via `disabled={status ===
  // "void"}`. The user can find out about missing email config
  // from the route itself, with a proper warning banner instead of
  // a silent disabled state.
  const [
    { data: lineItems },
    { data: settings },
    { data: history },
    { data: payments },
    { data: outboxSends },
    { data: invoicedEntries },
  ] = await Promise.all([
    supabase
      .from("invoice_line_items")
      .select("*, time_entries(user_id)")
      .eq("invoice_id", id)
      .order("id"),
    supabase
      .from("team_settings")
      .select(
        "business_name, business_email, business_address, business_phone, wordmark_primary, wordmark_secondary, brand_color, show_country_on_invoice",
      )
      .eq("team_id", invoice.team_id)
      .single(),
    supabase
      .from("invoices_history")
      .select("id, changed_at, changed_by_user_id, previous_state")
      .eq("invoice_id", id)
      .order("changed_at", { ascending: true }),
    supabase
      .from("invoice_payments")
      .select(
        "id, amount, currency, paid_on, paid_at, method, reference, created_at, created_by_user_id",
      )
      .eq("invoice_id", id)
      .order("paid_on", { ascending: true }),
    // Per-send rows from the messaging outbox. Drives the activity
    // log's "Sent" events so re-sends each render distinctly with
    // their own timestamp + recipients + PDF SHA-256 — the
    // bookkeeper-grade audit trail. Filter to only rows the user
    // could have actually delivered (sent_at IS NOT NULL); queued
    // rows that errored before dispatch are excluded so the activity
    // log doesn't claim a send happened when it didn't.
    supabase
      .from("message_outbox")
      .select(
        "id, sent_at, user_id, to_emails, attachment_pdf_sha256",
      )
      .eq("related_kind", "invoice")
      .eq("related_id", id)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: true }),
    // Harvest's invoice payload doesn't expose a line-item ↔ time-entry
    // mapping, so imported invoice_line_items.time_entry_id is NULL and
    // the line-item-level avatar lookup misses. But the time entries
    // themselves carry invoice_id (set by the same import pass when
    // Harvest reports them as billed), so we can derive the author(s)
    // for unattributed lines from the entries that rolled up into this
    // invoice. For a solo consultant — the dominant case — this collapses
    // to a single user.
    //
    // Project + category + date are pulled here too so the page can
    // re-derive each line item's description in the new
    // `[<code>] Project: Task (range)` format. When source entries
    // are no longer present (FK SET NULL after entry deletion), the
    // page falls back to the stored `invoice_line_items.description`.
    supabase
      .from("time_entries")
      .select(
        "id, user_id, duration_min, description, start_time, projects(name, invoice_code, hourly_rate, customers(default_rate)), categories(name)",
      )
      .eq("invoice_id", id),
  ]);

  // Distinct authors of time entries linked to this invoice. If exactly
  // one, use them as the implicit author for any line item that didn't
  // resolve through its own time_entry_id. Multi-author invoices fall
  // through to the "Imported from Harvest" fallback.
  const uniqueEntryAuthorIds = Array.from(
    new Set(
      (invoicedEntries ?? [])
        .map((e) => (e.user_id as string | null) ?? null)
        .filter((id): id is string => id !== null),
    ),
  );
  const implicitAuthorUserId =
    uniqueEntryAuthorIds.length === 1 ? uniqueEntryAuthorIds[0]! : null;

  // Resolve display names + avatars for everyone who appears on
  // this page: time-entry authors on line items, plus actors on
  // activity events (history changes + payment recorders + invoice
  // creator). Bulk-resolve in one query.
  const lineItemUserIds = (lineItems ?? [])
    .map((li) => {
      const te = li.time_entries;
      if (!te || typeof te !== "object" || !("user_id" in te)) return null;
      return (te as { user_id: string | null }).user_id;
    })
    .filter((id): id is string => id !== null && id !== undefined);
  const activityUserIds = [
    invoice.created_by_user_id as string | null,
    ...(history ?? []).map(
      (h) => h.changed_by_user_id as string | null,
    ),
    ...(payments ?? []).map(
      (p) => p.created_by_user_id as string | null,
    ),
    // Outbox-send authors so each "Sent by X" row in the activity
    // log resolves an avatar instead of falling back to "Unknown".
    ...(outboxSends ?? []).map(
      (s) => s.user_id as string | null,
    ),
  ].filter((id): id is string => id !== null && id !== undefined);
  const userIds = Array.from(
    new Set([
      ...lineItemUserIds,
      ...activityUserIds,
      ...(implicitAuthorUserId ? [implicitAuthorUserId] : []),
    ]),
  );
  const { data: profiles } =
    userIds.length > 0
      ? await supabase
          .from("user_profiles")
          .select("user_id, display_name, avatar_url")
          .in("user_id", userIds)
      : { data: [] };
  const profileById = new Map<
    string,
    { displayName: string; avatarUrl: string | null }
  >();
  for (const p of profiles ?? []) {
    profileById.set(p.user_id as string, {
      displayName: (p.display_name as string | null) ?? "Unknown",
      avatarUrl: (p.avatar_url as string | null) ?? null,
    });
  }
  const client =
    invoice.customers && typeof invoice.customers === "object"
      ? (invoice.customers as {
          name: string;
          email: string | null;
          address: string | null;
          show_country_on_invoice: boolean | null;
        })
      : null;

  // Re-derive line item descriptions from source entries when
  // available, so any invoice (including drafts created before the
  // [code] / per-line-date format landed) automatically reflects
  // the new shape. Falls back to the stored `lineItems` when no
  // source entries are linked (legacy Harvest-import edge case).
  const resolvedLineItems = (() => {
    const sourceEntries = invoicedEntries ?? [];
    if (sourceEntries.length === 0) {
      return (lineItems ?? []).map((li) => ({
        description: (li.description as string) ?? "",
        quantity: Number(li.quantity ?? 0),
        unit_price: Number(li.unit_price ?? 0),
        amount: Number(li.amount ?? 0),
      }));
    }
    type SrcRow = {
      id: string;
      user_id: string | null;
      duration_min: number | null;
      description: string | null;
      start_time: string | null;
      projects: {
        name: string | null;
        invoice_code: string | null;
        hourly_rate: number | null;
        customers: { default_rate: number | null } | null;
      } | null;
      categories: { name: string | null } | null;
    };
    const candidates: EntryCandidate[] = sourceEntries.map((row) => {
      const r = row as unknown as SrcRow;
      const proj = r.projects ?? null;
      const rate =
        (proj?.hourly_rate != null ? Number(proj.hourly_rate) : null) ??
        (proj?.customers?.default_rate != null
          ? Number(proj.customers.default_rate)
          : null) ??
        0;
      return {
        id: r.id,
        durationMin: Number(r.duration_min ?? 0),
        rate,
        description: r.description,
        projectName: proj?.name ?? "Project",
        projectInvoiceCode: proj?.invoice_code ?? null,
        taskName: r.categories?.name ?? null,
        // personName isn't surfaced for the line description in the
        // current grouping modes, but the type requires it. Author
        // resolution for display-time avatar lookup is handled
        // separately via implicitAuthorUserId, so passing a
        // placeholder here is safe.
        personName: r.user_id ?? "Unknown",
        date:
          r.start_time && r.start_time.length >= 10
            ? r.start_time.slice(0, 10)
            : "",
      };
    });
    const groupingMode = (invoice.grouping_mode as
      | "by_project"
      | "by_task"
      | "by_person"
      | "detailed"
      | null) ?? "by_project";
    const grouped = groupEntriesIntoLineItems(candidates, groupingMode);
    return grouped.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      amount: line.amount,
    }));
  })();

  const paymentsTotal = (payments ?? []).reduce(
    (sum, p) => sum + Number(p.amount ?? 0),
    0,
  );

  const status = (invoice.status as string | null) ?? "draft";
  // Terminal states (void / paid) get a prominent badge on its own
  // row under the page title — the user can't miss the state at a
  // glance. Draft / sent / overdue stay on the title row as a
  // small pill (the bigger chip would be visual noise on the
  // common in-flight states). UX persona review picked this split.
  const showProminentBadge = status === "void" || status === "paid";
  const isVoid = status === "void";

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <FileText size={24} className="text-accent" />
          <h1 className="text-page-title font-bold text-content font-mono">
            {invoice.invoice_number}
          </h1>
          {!showProminentBadge && (
            <InvoiceStatusBadge status={status} />
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SendInvoiceButton
            invoiceId={invoice.id as string}
            disabled={status === "void"}
          />
          <InvoicePdfButton
            invoice={invoice}
            lineItems={resolvedLineItems}
            client={client}
            business={settings}
            paymentsTotal={paymentsTotal}
          />
          <InvoiceActions
            invoiceId={invoice.id}
            currentStatus={status}
            invoiceNumber={invoice.invoice_number}
          />
        </div>
      </div>
      {showProminentBadge && (
        <div className="mt-3">
          <InvoiceStatusBadge status={status} size="prominent" />
        </div>
      )}

      {/* Invoice details */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-edge bg-surface-raised p-4">
          <h3 className="text-label font-semibold uppercase tracking-wider text-content-muted mb-2">
            {t("pdf.billTo")}
          </h3>
          <p className="font-medium text-content">{client?.name ?? "—"}</p>
          {client?.email && (
            <p className="text-body text-content-secondary">{client.email}</p>
          )}
          {trimCountryLines(
            formatAddressMultiLine(deserializeAddress(client?.address ?? null)),
            client?.show_country_on_invoice ?? false,
          ).map((line, i) => (
            <p key={i} className="text-body text-content-secondary">
              {line}
            </p>
          ))}
        </div>
        <div className="rounded-lg border border-edge bg-surface-raised p-4">
          <h3 className="text-label font-semibold uppercase tracking-wider text-content-muted mb-2">
            {t("pdf.from")}
          </h3>
          <p className="font-medium text-content">
            {settings?.business_name ?? "—"}
          </p>
          {settings?.business_email && (
            <p className="text-body text-content-secondary">
              {settings.business_email}
            </p>
          )}
          {trimCountryLines(
            formatAddressMultiLine(
              deserializeAddress(settings?.business_address ?? null),
            ),
            settings?.show_country_on_invoice ?? false,
          ).map((line, i) => (
            <p key={i} className="text-body text-content-secondary">
              {line}
            </p>
          ))}
        </div>
      </div>

      {/* Dates */}
      <div className="mt-4 flex flex-wrap gap-6 text-body text-content-secondary">
        <div>
          <span className="text-content-muted">{t("pdf.date")}:</span>{" "}
          {invoice.issued_date ? formatDate(invoice.issued_date) : "—"}
        </div>
        <div>
          <span className="text-content-muted">{t("pdf.dueDate")}:</span>{" "}
          {invoice.due_date ? formatDate(invoice.due_date) : "—"}
          {invoice.payment_terms_label ? (
            <span className="text-content-muted">
              {" "}
              ({invoice.payment_terms_label as string})
            </span>
          ) : null}
        </div>
        {(invoice.period_start || invoice.period_end) && (
          <div>
            <span className="text-content-muted">
              {t("servicePeriod")}:
            </span>{" "}
            {invoice.period_start
              ? formatDate(invoice.period_start as string)
              : "—"}{" "}
            →{" "}
            {invoice.period_end
              ? formatDate(invoice.period_end as string)
              : "—"}
          </div>
        )}
      </div>

      {/* Line items table — dimmed when void to telegraph "this is
          dead, don't act on it" without removing the audit-trail
          numbers (bookkeepers still need to read them). The PAID /
          VOID watermark sits absolutely positioned inside this
          container so it overlays the content without affecting
          layout, mirroring the PDF treatment. */}
      <div
        className={`relative mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised ${
          isVoid ? "opacity-70" : ""
        }`}
      >
        {(status === "paid" || status === "void") && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center z-10"
          >
            <span
              className={`select-none -rotate-12 border-4 px-7 py-2.5 rounded-md text-[3rem] font-extrabold tracking-[0.25em] opacity-30 ${
                status === "paid"
                  ? "border-success text-success"
                  : "border-warning text-warning"
              }`}
            >
              {status === "paid" ? "PAID" : "VOID"}
            </span>
          </div>
        )}
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-edge bg-surface-inset">
              <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.description")}
              </th>
              <th className="px-4 py-3 text-left text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.author")}
              </th>
              <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.hours")}
              </th>
              <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.rate")}
              </th>
              <th className="px-4 py-3 text-right text-label font-semibold uppercase tracking-wider text-content-muted">
                {t("lineItem.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {resolvedLineItems.map((item, idx) => {
              // Author for the row. Re-derived lines roll up multiple
              // entries; per-line author resolution is replaced by
              // the invoice-level implicit author (single-author
              // invoices, the dominant case). Multi-author falls
              // through to the Harvest-import / em-dash branches.
              const userId = implicitAuthorUserId;
              const profile = userId ? profileById.get(userId) : null;
              return (
                <tr
                  key={idx}
                  className={`border-b border-edge last:border-0 ${
                    idx % 2 === 1 ? "bg-surface-inset/40" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-content">{item.description}</td>
                  <td className="px-4 py-3">
                    {profile ? (
                      <span className="inline-flex items-center gap-2 text-body text-content-secondary">
                        <Avatar
                          avatarUrl={resolveAvatarUrl(
                            profile.avatarUrl,
                            userId ?? "",
                          )}
                          displayName={profile.displayName}
                          size={20}
                        />
                        <span className="truncate">{profile.displayName}</span>
                      </span>
                    ) : invoice.imported_from === "harvest" ? (
                      // Imported invoice line items don't link back to
                      // individual time entries (Harvest's invoice
                      // payload returns aggregated description lines, no
                      // entry-level mapping). Show an explicit
                      // "Imported from Harvest" so the column doesn't
                      // misread as "we don't know who logged this."
                      <Tooltip label={t("table.importedFromHarvest")}>
                        <span className="inline-flex items-center gap-1.5 text-caption text-content-muted">
                          <Download size={12} aria-hidden="true" />
                          <span>{t("table.importedFromHarvest")}</span>
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="text-caption text-content-muted">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-content-secondary">
                    {Number(item.quantity).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-content-secondary">
                    {formatCurrency(
                      Number(item.unit_price),
                      (invoice.currency as string | null) ?? undefined,
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-content">
                    {formatCurrency(
                      Number(item.amount),
                      (invoice.currency as string | null) ?? undefined,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totals — Subtotal / Discount? / Tax? / Payments? / Amount Due
            shape mirrors what bookkeepers expect and matches the PDF.
            The grand-total label flips to "Amount Due" when payments
            are recorded so the user sees the actual balance owed,
            same convention Harvest uses. */}
        {(() => {
          const currency = (invoice.currency as string | null) ?? undefined;
          const paymentsTotal = (payments ?? []).reduce(
            (sum, p) => sum + Number(p.amount ?? 0),
            0,
          );
          const discountAmount = Number(invoice.discount_amount ?? 0);
          const discountRate = invoice.discount_rate as number | null;
          const taxRate = Number(invoice.tax_rate ?? 0);
          const taxAmount = Number(invoice.tax_amount ?? 0);
          const total = Number(invoice.total ?? 0);
          const amountDue = Math.max(0, total - paymentsTotal);
          const showPayments = paymentsTotal > 0;
          return (
            <div className="border-t border-edge bg-surface-inset px-4 py-3">
              <div className="flex justify-end gap-[32px]">
                <div className="text-right space-y-1">
                  <p className="text-body text-content-muted">
                    {t("fields.subtotal")}
                  </p>
                  {discountAmount > 0 && (
                    <p className="text-body text-content-muted">
                      {t("fields.discount")}
                      {discountRate !== null && ` (${Number(discountRate)}%)`}
                    </p>
                  )}
                  {taxRate > 0 && (
                    <p className="text-body text-content-muted">
                      {t("fields.taxAmount")} ({taxRate}%)
                    </p>
                  )}
                  {showPayments && (
                    <p className="text-body text-content-muted">
                      {t("fields.payments")}
                    </p>
                  )}
                  <p className="text-body font-semibold text-content">
                    {t("fields.amountDue")}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-body font-mono tabular-nums text-content-secondary">
                    {formatCurrency(Number(invoice.subtotal), currency)}
                  </p>
                  {discountAmount > 0 && (
                    <p className="text-body font-mono tabular-nums text-content-secondary">
                      ({formatCurrency(discountAmount, currency)})
                    </p>
                  )}
                  {taxRate > 0 && (
                    <p className="text-body font-mono tabular-nums text-content-secondary">
                      {formatCurrency(taxAmount, currency)}
                    </p>
                  )}
                  {showPayments && (
                    <p className="text-body font-mono tabular-nums text-content-secondary">
                      ({formatCurrency(paymentsTotal, currency)})
                    </p>
                  )}
                  <p className="text-body font-mono tabular-nums font-semibold text-content">
                    {formatCurrency(
                      showPayments ? amountDue : total,
                      currency,
                    )}
                  </p>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="mt-4 rounded-lg border border-edge bg-surface-raised p-4">
          <h3 className="text-label font-semibold uppercase tracking-wider text-content-muted mb-2">
            {t("pdf.notes")}
          </h3>
          <p className="text-body text-content-secondary whitespace-pre-wrap">
            {invoice.notes}
          </p>
        </div>
      )}

      {/* Activity log — derived from invoices_history + invoice_payments
          + status timestamps. Owner|admin only via RLS on the source
          tables; for non-privileged viewers the section renders empty
          and hides itself. */}
      <InvoiceActivity
        data={{
          invoice: {
            id: invoice.id as string,
            status: (invoice.status as string | null) ?? null,
            created_at: (invoice.created_at as string | null) ?? null,
            created_by_user_id:
              (invoice.created_by_user_id as string | null) ?? null,
            sent_at: (invoice.sent_at as string | null) ?? null,
            paid_at: (invoice.paid_at as string | null) ?? null,
            voided_at: (invoice.voided_at as string | null) ?? null,
            imported_at: (invoice.imported_at as string | null) ?? null,
            imported_from: (invoice.imported_from as string | null) ?? null,
            currency: (invoice.currency as string | null) ?? null,
            sent_to_email: (invoice.sent_to_email as string | null) ?? null,
            sent_to_name: (invoice.sent_to_name as string | null) ?? null,
          },
          history: (history ?? []).map((h) => ({
            id: h.id as string,
            changed_at: h.changed_at as string,
            changed_by_user_id:
              (h.changed_by_user_id as string | null) ?? null,
            previous_state:
              (h.previous_state as Record<string, unknown>) ?? {},
          })),
          payments: (payments ?? []).map((p) => ({
            id: p.id as string,
            amount: Number(p.amount),
            currency: (p.currency as string | null) ?? null,
            paid_on: p.paid_on as string,
            paid_at: (p.paid_at as string | null) ?? null,
            method: (p.method as string | null) ?? null,
            reference: (p.reference as string | null) ?? null,
            created_at: p.created_at as string,
            created_by_user_id:
              (p.created_by_user_id as string | null) ?? null,
          })),
          outboxSends: (outboxSends ?? []).map((s) => ({
            id: s.id as string,
            sent_at: (s.sent_at as string | null) ?? null,
            user_id: (s.user_id as string | null) ?? null,
            to_emails: (s.to_emails as string[] | null) ?? [],
            attachment_pdf_sha256:
              (s.attachment_pdf_sha256 as string | null) ?? null,
          })),
        }}
        profileById={profileById}
        unknownUserLabel={(await getTranslations("common.authorship"))(
          "unknownUser",
        )}
      />
    </div>
  );
}
