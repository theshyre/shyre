import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Users } from "lucide-react";
import { NewClientForm } from "./new-client-form";
import { ArchiveButton } from "./archive-button";

export default async function ClientsPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const t = await getTranslations("clients");
  const tc = await getTranslations("common");

  const { data: clients } = await supabase
    .from("clients")
    .select("*")
    .eq("archived", false)
    .order("name");

  return (
    <div>
      <div className="flex items-center gap-3">
        <Users size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      <NewClientForm />

      {clients && clients.length > 0 ? (
        <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-surface-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge bg-surface-inset">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                  {tc("table.name")}
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
              {clients.map((client) => (
                <tr
                  key={client.id}
                  className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/clients/${client.id}`}
                      className="text-accent hover:underline font-medium"
                    >
                      {client.name}
                    </Link>
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
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-sm text-content-muted">
          {t("noClients")}
        </p>
      )}
    </div>
  );
}
