import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

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

  const { data: lineItems } = await supabase
    .from("invoice_line_items")
    .select("*, time_entries(user_id)")
    .eq("invoice_id", id)
    .order("id");

  const { data: settings } = await supabase
    .from("team_settings")
    .select("business_name, business_email, business_address, business_phone")
    .eq("team_id", invoice.team_id)
    .single();

  // Resolve display names + avatars for the time-entry authors that
  // these line items trace back to. Per CLAUDE.md "Time-entry
  // authorship — MANDATORY", every surface that displays content
  // tied to a time entry must show who logged it. Bulk-resolve in
  // one query to keep the page fast on long invoices.
  const userIds = Array.from(
    new Set(
      (lineItems ?? [])
        .map((li) => {
          const te = li.time_entries;
          if (!te || typeof te !== "object" || !("user_id" in te)) return null;
          return (te as { user_id: string | null }).user_id;
        })
        .filter((id): id is string => id !== null && id !== undefined),
    ),
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
  const tAuthor = await getTranslations("common.authorship");

  const client =
    invoice.customers && typeof invoice.customers === "object"
      ? (invoice.customers as { name: string; email: string | null; address: string | null })
      : null;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <FileText size={24} className="text-accent" />
          <h1 className="text-page-title font-bold text-content font-mono">
            {invoice.invoice_number}
          </h1>
          <InvoiceStatusBadge status={invoice.status ?? "draft"} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <InvoicePdfButton
            invoice={invoice}
            lineItems={lineItems ?? []}
            client={client}
            business={settings}
          />
          <InvoiceActions
            invoiceId={invoice.id}
            currentStatus={invoice.status ?? "draft"}
            invoiceNumber={invoice.invoice_number}
          />
        </div>
      </div>

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
          {client?.address && (
            <p className="text-body text-content-secondary">{client.address}</p>
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
          {settings?.business_address && (
            <p className="text-body text-content-secondary">
              {settings.business_address}
            </p>
          )}
        </div>
      </div>

      {/* Dates */}
      <div className="mt-4 flex gap-6 text-body text-content-secondary">
        <div>
          <span className="text-content-muted">{t("pdf.date")}:</span>{" "}
          {invoice.issued_date ? formatDate(invoice.issued_date) : "—"}
        </div>
        <div>
          <span className="text-content-muted">{t("pdf.dueDate")}:</span>{" "}
          {invoice.due_date ? formatDate(invoice.due_date) : "—"}
        </div>
      </div>

      {/* Line items table */}
      <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
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
              const userId =
                te && typeof te === "object" && "user_id" in te
                  ? ((te as { user_id: string | null }).user_id ?? null)
                  : null;
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
                    ) : (
                      <span className="text-caption text-content-muted italic">
                        {tAuthor("unknownUser")}
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

        {/* Totals */}
        <div className="border-t border-edge bg-surface-inset px-4 py-3">
          <div className="flex justify-end gap-[32px]">
            <div className="text-right space-y-1">
              <p className="text-body text-content-muted">
                {t("fields.subtotal")}
              </p>
              <p className="text-body text-content-muted">
                {t("fields.taxAmount")} ({Number(invoice.tax_rate)}%)
              </p>
              <p className="text-body font-semibold text-content">
                {t("fields.total")}
              </p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-body font-mono tabular-nums text-content-secondary">
                {formatCurrency(
                  Number(invoice.subtotal),
                  (invoice.currency as string | null) ?? undefined,
                )}
              </p>
              <p className="text-body font-mono tabular-nums text-content-secondary">
                {formatCurrency(
                  Number(invoice.tax_amount),
                  (invoice.currency as string | null) ?? undefined,
                )}
              </p>
              <p className="text-body font-mono tabular-nums font-semibold text-content">
                {formatCurrency(
                  Number(invoice.total),
                  (invoice.currency as string | null) ?? undefined,
                )}
              </p>
            </div>
          </div>
        </div>
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
    </div>
  );
}
