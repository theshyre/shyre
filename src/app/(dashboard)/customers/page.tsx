import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Users, Share2 } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import { NewCustomerForm } from "./new-customer-form";
import { ArchiveButton } from "./archive-button";

interface CustomerRow {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  default_rate: number | null;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const { org: selectedOrgId } = await searchParams;
  const t = await getTranslations("customers");
  const tc = await getTranslations("common");

  let customers: CustomerRow[] = [];

  if (selectedOrgId) {
    // Include customers owned by this org PLUS customers shared into this org
    const [ownedRes, sharedRes] = await Promise.all([
      supabase
        .from("customers")
        .select("id, organization_id, name, email, default_rate")
        .eq("archived", false)
        .eq("organization_id", selectedOrgId),
      supabase
        .from("customer_shares")
        .select("customer_id, customers(id, organization_id, name, email, default_rate, archived)")
        .eq("organization_id", selectedOrgId),
    ]);

    const owned = (ownedRes.data ?? []) as unknown as CustomerRow[];
    const shared = ((sharedRes.data ?? [])
      .map((r) => {
        const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
        return c as (CustomerRow & { archived: boolean }) | null;
      })
      .filter(
        (c): c is CustomerRow & { archived: boolean } =>
          c !== null && c.archived === false,
      )) as Array<CustomerRow & { archived: boolean }>;

    const byId = new Map<string, CustomerRow>();
    for (const c of owned) byId.set(c.id, c);
    for (const c of shared) {
      if (!byId.has(c.id))
        byId.set(c.id, {
          id: c.id,
          organization_id: c.organization_id,
          name: c.name,
          email: c.email,
          default_rate: c.default_rate,
        });
    }
    customers = Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } else {
    const { data } = await supabase
      .from("customers")
      .select("id, organization_id, name, email, default_rate")
      .eq("archived", false)
      .order("name");
    customers = (data ?? []) as unknown as CustomerRow[];
  }

  // Share counts for all visible customers
  const customerIds = customers.map((c) => c.id);
  const shareCounts = new Map<string, number>();
  if (customerIds.length > 0) {
    const { data: shareRows } = await supabase
      .from("customer_shares")
      .select("customer_id")
      .in("customer_id", customerIds);
    for (const s of shareRows ?? []) {
      shareCounts.set(s.customer_id, (shareCounts.get(s.customer_id) ?? 0) + 1);
    }
  }

  const orgName = (orgId: string) =>
    orgs.find((o) => o.id === orgId)?.name ?? "\u2014";

  return (
    <div>
      <div className="flex items-center gap-3">
        <Users size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={selectedOrgId ?? null} />
      </div>

      <NewCustomerForm orgs={orgs} defaultOrgId={selectedOrgId} />

      {customers && customers.length > 0 ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge bg-surface-inset">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {tc("table.name")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  Org
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {tc("table.email")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {t("table.defaultRate")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {tc("table.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((client) => {
                const shareCount = shareCounts.get(client.id) ?? 0;
                return (
                  <tr
                    key={client.id}
                    className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/customers/${client.id}`}
                          className="text-accent hover:underline font-medium"
                        >
                          {client.name}
                        </Link>
                        {shareCount > 0 && (
                          <span
                            title={`Shared with ${shareCount} org${shareCount === 1 ? "" : "s"}`}
                            className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
                          >
                            <Share2 size={10} />
                            {shareCount}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-content-secondary text-xs">
                      {orgName(client.organization_id)}
                    </td>
                    <td className="px-4 py-3 text-content-secondary">
                      {client.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-content-secondary font-mono">
                      {client.default_rate
                        ? `$${Number(client.default_rate).toFixed(2)}/hr`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ArchiveButton customerId={client.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-sm text-content-muted">{t("noCustomers")}</p>
      )}
    </div>
  );
}
