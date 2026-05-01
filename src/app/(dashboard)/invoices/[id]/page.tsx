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
  deserializeAddress,
  formatAddressMultiLine,
} from "@/lib/schemas/address";
import { InvoiceActions } from "./invoice-actions";
import { InvoicePdfButton } from "./invoice-pdf-button";
import { InvoiceStatusBadge } from "../invoice-status-badge";

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
    .select("*, customers(name, email, address)")
    .eq("id", id)
    .single();

  if (!invoice) notFound();

  // Line items, history, payments, and entry-authors-on-this-invoice
  // are independent reads — fire them in parallel rather than
  // waterfall. RLS scopes each one separately so a viewer who can't
  // see history (non-owner/admin) gets [] from that query and the
  // activity section just hides.
  const [
    { data: lineItems },
    { data: settings },
    { data: history },
    { data: payments },
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
        "business_name, business_email, business_address, business_phone, wordmark_primary, wordmark_secondary, brand_color",
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
    // Harvest's invoice payload doesn't expose a line-item ↔ time-entry
    // mapping, so imported invoice_line_items.time_entry_id is NULL and
    // the line-item-level avatar lookup misses. But the time entries
    // themselves carry invoice_id (set by the same import pass when
    // Harvest reports them as billed), so we can derive the author(s)
    // for unattributed lines from the entries that rolled up into this
    // invoice. For a solo consultant — the dominant case — this collapses
    // to a single user.
    supabase
      .from("time_entries")
      .select("user_id")
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
      ? (invoice.customers as { name: string; email: string | null; address: string | null })
      : null;

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
          <InvoicePdfButton
            invoice={invoice}
            lineItems={lineItems ?? []}
            client={client}
            business={settings}
            paymentsTotal={(payments ?? []).reduce(
              (sum, p) => sum + Number(p.amount ?? 0),
              0,
            )}
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
          {formatAddressMultiLine(deserializeAddress(client?.address ?? null)).map(
            (line, i) => (
              <p key={i} className="text-body text-content-secondary">
                {line}
              </p>
            ),
          )}
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
          {formatAddressMultiLine(
            deserializeAddress(settings?.business_address ?? null),
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
            {(lineItems ?? []).map((item) => {
              const te = item.time_entries;
              const directUserId =
                te && typeof te === "object" && "user_id" in te
                  ? ((te as { user_id: string | null }).user_id ?? null)
                  : null;
              // Direct attribution wins; otherwise fall back to the
              // implicit author derived from time_entries.invoice_id
              // (only set when this invoice has a single distinct
              // entry author).
              const userId = directUserId ?? implicitAuthorUserId;
              const profile = userId ? profileById.get(userId) : null;
              return (
                <tr
                  key={item.id}
                  className="border-b border-edge last:border-0"
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
                    {showPayments ? t("fields.amountDue") : t("fields.total")}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-body font-mono tabular-nums text-content-secondary">
                    {formatCurrency(Number(invoice.subtotal), currency)}
                  </p>
                  {discountAmount > 0 && (
                    <p className="text-body font-mono tabular-nums text-content-secondary">
                      −{formatCurrency(discountAmount, currency)}
                    </p>
                  )}
                  {taxRate > 0 && (
                    <p className="text-body font-mono tabular-nums text-content-secondary">
                      {formatCurrency(taxAmount, currency)}
                    </p>
                  )}
                  {showPayments && (
                    <p className="text-body font-mono tabular-nums text-content-secondary">
                      −{formatCurrency(paymentsTotal, currency)}
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
        }}
        profileById={profileById}
        unknownUserLabel={(await getTranslations("common.authorship"))(
          "unknownUser",
        )}
      />
    </div>
  );
}
