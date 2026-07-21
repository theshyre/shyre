import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Users, Clock3, UserCog, FileBadge, Banknote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getUserTeams,
  isTeamAdmin,
  validateBusinessAccess,
} from "@/lib/team-context";
import { LinkPendingSpinner } from "@/components/LinkPendingSpinner";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ businessId: string }>;
}): Promise<Metadata> {
  const { businessId } = await params;
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("name, legal_name")
    .eq("id", businessId)
    .maybeSingle();
  const t = await getTranslations("business");
  if (!business) {
    return { title: t("title") };
  }
  return {
    title:
      ((business.legal_name as string | null) ??
        (business.name as string | null) ??
        t("untitled")) as string,
  };
}

interface PageProps {
  params: Promise<{ businessId: string }>;
}

export default async function BusinessOverviewPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { businessId } = await params;
  const t = await getTranslations("business");
  const supabase = await createClient();

  // Stats are scoped to every team under this business that the viewer
  // is a member of. Single-team businesses match exactly one team here;
  // multi-team agencies sum across the group. NOTE: the Overview shows
  // NO money — dollars live behind the owner/admin-only Financials tab so
  // the always-first tab stays safe to open while screen-sharing.
  const userTeams = await getUserTeams();
  const userTeamIds = userTeams.map((tm) => tm.id);
  const { data: businessTeams } =
    userTeamIds.length > 0
      ? await supabase
          .from("teams")
          .select("id")
          .eq("business_id", businessId)
          .in("id", userTeamIds)
      : { data: [] };
  const teamIds = (businessTeams ?? []).map((row) => row.id as string);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [customerRes, entriesRes, peopleRes, identityRes, access] =
    await Promise.all([
      teamIds.length > 0
        ? supabase
            .from("customers")
            .select("id", { count: "exact", head: true })
            .in("team_id", teamIds)
            .eq("archived", false)
        : Promise.resolve({ count: 0 }),
      teamIds.length > 0
        ? supabase
            .from("time_entries")
            .select("duration_min")
            .in("team_id", teamIds)
            .eq("billable", true)
            .not("end_time", "is", null)
            .is("deleted_at", null)
            .gte("start_time", monthStart.toISOString())
        : Promise.resolve({ data: [] }),
      supabase
        .from("business_people")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .is("deleted_at", null),
      supabase
        .from("businesses")
        .select("legal_name")
        .eq("id", businessId)
        .maybeSingle(),
      validateBusinessAccess(businessId),
    ]);

  const customerCount = customerRes.count ?? 0;
  const peopleCount = peopleRes.count ?? 0;
  const totalMin = (entriesRes.data ?? []).reduce(
    (s, e) => s + ((e.duration_min as number | null) ?? 0),
    0,
  );
  const billableHours = Math.round((totalMin / 60) * 10) / 10;
  const identityNeedsSetup = !identityRes.data?.legal_name;
  const canViewFinancials = isTeamAdmin(access.role);

  return (
    <div className="space-y-6">
      {/* Non-sensitive operational vitals — no money. */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label={t("stats.customers")}
          value={String(customerCount)}
          href={null}
        />
        <StatCard
          icon={Clock3}
          label={t("stats.billableHours")}
          caption={t("overview.thisMonth")}
          value={`${billableHours}h`}
          href="/time-entries"
        />
        <StatCard
          icon={UserCog}
          label={t("overview.people")}
          value={String(peopleCount)}
          href={`/business/${businessId}/people`}
        />
      </section>

      {/* Money lives behind the Financials tab (owner/admin only). Point
          to it rather than rendering any figure here. */}
      {canViewFinancials && (
        <Link
          href={`/business/${businessId}/financials`}
          className="group flex items-center gap-4 rounded-lg border border-edge bg-surface-raised p-5 hover:bg-hover transition-colors"
        >
          <Banknote size={22} className="text-accent shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-body-lg font-semibold text-content">
              {t("overview.financials.title")}
            </p>
            <p className="mt-0.5 text-caption text-content-secondary">
              {t("overview.financials.summary")}
            </p>
          </div>
          <span className="text-accent-text group-hover:translate-x-0.5 transition-transform" aria-hidden="true">
            →
          </span>
          <LinkPendingSpinner size={14} className="" />
        </Link>
      )}

      {identityNeedsSetup && (
        <Link
          href={`/business/${businessId}/identity`}
          className="group flex items-center gap-4 rounded-lg border border-accent/40 bg-accent-soft/40 p-5 hover:bg-accent-soft transition-colors"
        >
          <FileBadge size={24} className="text-accent shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-body-lg font-semibold text-content">
              {t("identityCta.title")}
            </p>
            <p className="mt-0.5 text-caption text-content-secondary">
              {t("identityCta.summary")}
            </p>
          </div>
          <span className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-body font-medium text-content-inverse group-hover:opacity-90 transition-opacity">
            {t("identityCta.action")}
          </span>
          <LinkPendingSpinner size={14} className="" />
        </Link>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  caption,
  href,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  caption?: string;
  /** When null, renders a non-interactive card. Used for stats whose
   *  natural drill-down doesn't yet support a business filter. */
  href: string | null;
}): React.JSX.Element {
  const inner = (
    <>
      <Icon size={20} className="text-accent shrink-0" aria-hidden="true" />
      <div>
        <p className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {label}
          {caption && (
            <span className="ml-1 normal-case font-normal tracking-normal text-content-muted">
              · {caption}
            </span>
          )}
        </p>
        <p className="text-page-title font-semibold text-content font-mono tabular-nums">
          {value}
        </p>
      </div>
    </>
  );
  const cls =
    "flex items-center gap-4 rounded-lg border border-edge bg-surface-raised p-4";
  if (href === null) {
    return <div className={cls}>{inner}</div>;
  }
  return (
    <Link href={href} className={`${cls} hover:bg-hover transition-colors`}>
      {inner}
    </Link>
  );
}
