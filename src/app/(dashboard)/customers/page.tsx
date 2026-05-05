import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("title") };
}
import { Users, MailWarning, Download } from "lucide-react";
import { TeamFilter } from "@/components/TeamFilter";
import { NewCustomerForm } from "./new-customer-form";
import { CustomersTable } from "./customers-table";
import { buttonSecondaryClass } from "@/lib/form-styles";

async function CustomersExportLink({
  selectedTeamId,
}: {
  selectedTeamId?: string;
}): Promise<React.JSX.Element> {
  const t = await getTranslations("customers");
  const href = selectedTeamId
    ? `/api/customers/csv?org=${encodeURIComponent(selectedTeamId)}`
    : `/api/customers/csv`;
  return (
    <a href={href} download className={buttonSecondaryClass}>
      <Download size={14} />
      {t("exportCsv")}
    </a>
  );
}

interface CustomerRow {
  id: string;
  team_id: string;
  name: string;
  email: string | null;
  default_rate: number | null;
  /** Timestamp Resend's webhook flagged the customer's email as a
   *  hard bounce. When set, future sends should skip them by
   *  default (Phase 2) and the row gets a warning chip on the list. */
  bounced_at: string | null;
  /** Timestamp Resend's webhook flagged the customer as complained
   *  (marked as spam). Same treatment as bounced — separate column
   *  so the icon + reason can differ. */
  complained_at: string | null;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; bounced?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const { org: selectedTeamId, bounced: bouncedFilter } = await searchParams;
  const t = await getTranslations("customers");
  // ?bounced=1 narrows the list to customers Resend has flagged
  // (hard bounce or spam complaint). Surfaces who needs a fresh
  // contact email before any future send.
  const onlyBounced = bouncedFilter === "1";

  let customers: CustomerRow[] = [];

  if (selectedTeamId) {
    // Include customers owned by this org PLUS customers shared into this org
    const [ownedRes, sharedRes] = await Promise.all([
      supabase
        .from("customers_v")
        .select(
          "id, team_id, name, email, default_rate, bounced_at, complained_at",
        )
        .eq("archived", false)
        .eq("team_id", selectedTeamId),
      supabase
        .from("customer_shares")
        .select(
          "customer_id, customers_v(id, team_id, name, email, default_rate, bounced_at, complained_at, archived)",
        )
        .eq("team_id", selectedTeamId),
    ]);

    const owned = (ownedRes.data ?? []) as unknown as CustomerRow[];
    const shared = ((sharedRes.data ?? [])
      .map((r) => {
        const embedded = (r as unknown as { customers_v: unknown }).customers_v;
        const c = Array.isArray(embedded) ? embedded[0] : embedded;
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
          team_id: c.team_id,
          name: c.name,
          email: c.email,
          default_rate: c.default_rate,
          bounced_at: c.bounced_at,
          complained_at: c.complained_at,
        });
    }
    customers = Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } else {
    const { data } = await supabase
      .from("customers_v")
      .select(
        "id, team_id, name, email, default_rate, bounced_at, complained_at",
      )
      .eq("archived", false)
      .order("name");
    customers = (data ?? []) as unknown as CustomerRow[];
  }

  // Bounced banner + ?bounced=1 filter. Compute the count BEFORE
  // applying the filter so the banner always shows the universe of
  // affected customers, not just the ones currently visible.
  const bouncedCount = customers.filter(
    (c) => c.bounced_at || c.complained_at,
  ).length;
  if (onlyBounced) {
    customers = customers.filter(
      (c) => c.bounced_at || c.complained_at,
    );
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

  return (
    <div>
      <div className="flex items-center gap-3">
        <Users size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <TeamFilter teams={teams} selectedTeamId={selectedTeamId ?? null} />
        <div className="ml-auto">
          <CustomersExportLink selectedTeamId={selectedTeamId} />
        </div>
      </div>

      <NewCustomerForm teams={teams} defaultTeamId={selectedTeamId} />

      {bouncedCount > 0 && (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning-soft/30 px-4 py-3 text-body text-content flex items-center gap-2">
          <MailWarning size={16} className="text-warning shrink-0" />
          <span className="flex-1">
            {t("bouncedBanner", { count: bouncedCount })}
          </span>
          {onlyBounced ? (
            <Link
              href={`/customers${selectedTeamId ? `?org=${selectedTeamId}` : ""}`}
              className="text-caption text-accent hover:underline"
            >
              {t("bouncedShowAll")}
            </Link>
          ) : (
            <Link
              href={`/customers?bounced=1${selectedTeamId ? `&org=${selectedTeamId}` : ""}`}
              className="text-caption text-accent hover:underline"
            >
              {t("bouncedShowOnly")}
            </Link>
          )}
        </div>
      )}

      <CustomersTable
        customers={customers ?? []}
        shareCounts={shareCounts}
        teamNameById={
          new Map(
            teams.map((o) => [o.id as string, (o.name as string) ?? "—"]),
          )
        }
      />
    </div>
  );
}
