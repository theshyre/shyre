import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Users, Share2 } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import { NewClientForm } from "./new-client-form";
import { ArchiveButton } from "./archive-button";

interface ClientRow {
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
  const t = await getTranslations("clients");
  const tc = await getTranslations("common");

  let clients: ClientRow[] = [];

  if (selectedOrgId) {
    // Include clients owned by this org PLUS clients shared into this org
    const [ownedRes, sharedRes] = await Promise.all([
      supabase
        .from("clients")
        .select("id, organization_id, name, email, default_rate")
        .eq("archived", false)
        .eq("organization_id", selectedOrgId),
      supabase
        .from("client_shares")
        .select("client_id, clients(id, organization_id, name, email, default_rate, archived)")
        .eq("organization_id", selectedOrgId),
    ]);

    const owned = (ownedRes.data ?? []) as unknown as ClientRow[];
    const shared = ((sharedRes.data ?? [])
      .map((r) => {
        const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
        return c as (ClientRow & { archived: boolean }) | null;
      })
      .filter(
        (c): c is ClientRow & { archived: boolean } =>
          c !== null && c.archived === false,
      )) as Array<ClientRow & { archived: boolean }>;

    const byId = new Map<string, ClientRow>();
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
    clients = Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } else {
    const { data } = await supabase
      .from("clients")
      .select("id, organization_id, name, email, default_rate")
      .eq("archived", false)
      .order("name");
    clients = (data ?? []) as unknown as ClientRow[];
  }

  // Share counts for all visible clients
  const clientIds = clients.map((c) => c.id);
  const shareCounts = new Map<string, number>();
  if (clientIds.length > 0) {
    const { data: shareRows } = await supabase
      .from("client_shares")
      .select("client_id")
      .in("client_id", clientIds);
    for (const s of shareRows ?? []) {
      shareCounts.set(s.client_id, (shareCounts.get(s.client_id) ?? 0) + 1);
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

      <NewClientForm orgs={orgs} defaultOrgId={selectedOrgId} />

      {clients && clients.length > 0 ? (
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
              {clients.map((client) => {
                const shareCount = shareCounts.get(client.id) ?? 0;
                return (
                  <tr
                    key={client.id}
                    className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/clients/${client.id}`}
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
                      <ArchiveButton clientId={client.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-sm text-content-muted">{t("noClients")}</p>
      )}
    </div>
  );
}
