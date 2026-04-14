import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { buttonPrimaryClass } from "@/lib/form-styles";
import { formatCurrency } from "@/lib/invoice-utils";
import { OrgFilter } from "@/components/OrgFilter";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const { org: selectedOrgId } = await searchParams;
  const t = await getTranslations("invoices");

  let query = supabase
    .from("invoices")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });
  if (selectedOrgId) query = query.eq("organization_id", selectedOrgId);
  const { data: invoices } = await query;

  const orgName = (orgId: string) => orgs.find(o => o.id === orgId)?.name ?? "\u2014";

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-accent" />
          <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
          <OrgFilter orgs={orgs} selectedOrgId={selectedOrgId ?? null} />
        </div>
        <Link href="/invoices/new" className={buttonPrimaryClass}>
          <Plus size={16} />
          {t("newInvoice")}
        </Link>
      </div>

      {invoices && invoices.length > 0 ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge bg-surface-inset">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.invoiceNumber")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  Org
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.customer")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.issuedDate")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.total")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const customerName =
                  inv.customers &&
                  typeof inv.customers === "object" &&
                  "name" in inv.customers
                    ? (inv.customers as { name: string }).name
                    : "—";
                return (
                  <tr
                    key={inv.id}
                    className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="text-accent hover:underline font-medium font-mono"
                      >
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-content-secondary text-xs">
                      {orgName(inv.organization_id)}
                    </td>
                    <td className="px-4 py-3 text-content-secondary">
                      {customerName}
                    </td>
                    <td className="px-4 py-3 text-content-secondary text-xs">
                      {inv.issued_date
                        ? new Date(inv.issued_date).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-content">
                      {inv.total ? formatCurrency(Number(inv.total)) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge
                        status={inv.status ?? "draft"}
                        label={t(`status.${inv.status ?? "draft"}`)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-sm text-content-muted">
          {t("noInvoices")}
        </p>
      )}
    </div>
  );
}

function InvoiceStatusBadge({
  status,
  label,
}: {
  status: string;
  label: string;
}): React.JSX.Element {
  const colorMap: Record<string, string> = {
    draft: "bg-surface-inset text-content-muted",
    sent: "bg-info-soft text-info",
    paid: "bg-success-soft text-success",
    overdue: "bg-error-soft text-error",
    void: "bg-surface-inset text-content-muted",
  };
  const classes = colorMap[status] ?? "bg-surface-inset text-content-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
