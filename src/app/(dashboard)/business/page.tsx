import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Briefcase, Pencil, Users, DollarSign, Receipt } from "lucide-react";
import { OrgFilter } from "@/components/OrgFilter";
import { buttonSecondaryClass } from "@/lib/form-styles";

const ENTITY_TYPE_LABEL: Record<string, string> = {
  sole_prop: "Sole Proprietorship",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  nonprofit: "Nonprofit",
  other: "Other",
};

export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const t = await getTranslations("business");
  const { org: selectedOrgId } = await searchParams;

  // Default to the first org if none selected
  const orgId = selectedOrgId ?? orgs[0]?.id ?? null;
  const selectedOrg = orgs.find((o) => o.id === orgId);

  let settings: Record<string, unknown> | null = null;
  if (orgId) {
    const { data } = await supabase
      .from("organization_settings")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    settings = data;
  }

  // Quick stats: customers + this month's billable hours for this org
  let customerCount = 0;
  let billableHoursThisMonth = 0;
  let expensesThisMonthTotal = 0;
  let expensesThisMonthCount = 0;
  if (orgId) {
    const { count } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("archived", false);
    customerCount = count ?? 0;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { data: entries } = await supabase
      .from("time_entries")
      .select("duration_min")
      .eq("organization_id", orgId)
      .eq("billable", true)
      .not("end_time", "is", null)
      .gte("start_time", monthStart.toISOString());
    const totalMin = (entries ?? []).reduce(
      (s, e) => s + (e.duration_min ?? 0),
      0,
    );
    billableHoursThisMonth = Math.round((totalMin / 60) * 10) / 10;

    const monthStartStr = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;
    const { data: expenseRows } = await supabase
      .from("expenses")
      .select("amount")
      .eq("organization_id", orgId)
      .gte("incurred_on", monthStartStr);
    expensesThisMonthCount = expenseRows?.length ?? 0;
    expensesThisMonthTotal = (expenseRows ?? []).reduce(
      (s, e) => s + Number(e.amount ?? 0),
      0,
    );
  }

  const entityKey = settings?.entity_type ? String(settings.entity_type) : null;
  const entityLabel: string | null = entityKey
    ? ENTITY_TYPE_LABEL[entityKey] ?? entityKey
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Briefcase size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
        <OrgFilter orgs={orgs} selectedOrgId={orgId ?? null} />
      </div>
      <p className="text-sm text-content-secondary">{t("subtitle")}</p>

      {/* Business identity card */}
      <section className="rounded-lg border border-edge bg-surface-raised p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
            {t("sections.identity")}
          </h2>
          <Link href={`/business/info?org=${orgId ?? ""}`} className={buttonSecondaryClass}>
            <Pencil size={14} />
            {t("edit")}
          </Link>
        </div>

        {!orgId ? (
          <p className="text-sm text-content-muted">{t("noOrg")}</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.legalName")} value={stringify(settings?.legal_name) ?? selectedOrg?.name ?? null} />
            <Field label={t("fields.entityType")} value={entityLabel} />
            <Field label={t("fields.taxId")} value={stringify(settings?.tax_id)} mono />
            <Field label={t("fields.stateRegistrationId")} value={stringify(settings?.state_registration_id)} mono />
            <Field label={t("fields.registeredState")} value={stringify(settings?.registered_state)} />
            <Field label={t("fields.dateIncorporated")} value={stringify(settings?.date_incorporated)} />
            <Field label={t("fields.fiscalYearStart")} value={stringify(settings?.fiscal_year_start)} mono />
          </dl>
        )}
      </section>

      {/* Stats */}
      {orgId && (
        <section className="grid gap-4 sm:grid-cols-2">
          <StatCard
            icon={Users}
            label={t("stats.customers")}
            value={String(customerCount)}
            href="/customers"
          />
          <StatCard
            icon={DollarSign}
            label={t("stats.billableHours")}
            value={`${billableHoursThisMonth}h`}
            href="/time-entries"
          />
        </section>
      )}

      {/* Module tiles */}
      {orgId && (
        <section className="grid gap-4 sm:grid-cols-2">
          <Link
            href={`/business/expenses?org=${orgId}`}
            className="flex items-start gap-4 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
          >
            <Receipt size={20} className="text-accent shrink-0 mt-1" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-content">{t("tiles.expenses.title")}</p>
              <p className="mt-0.5 text-xs text-content-muted">
                {t("tiles.expenses.summary", {
                  count: expensesThisMonthCount,
                  amount: new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                  }).format(expensesThisMonthTotal),
                })}
              </p>
            </div>
          </Link>
          <PlaceholderCard title={t("tiles.people.title")} hint={t("tiles.people.hint")} />
        </section>
      )}
    </div>
  );
}

function stringify(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">
        {label}
      </dt>
      <dd
        className={`text-sm text-content ${mono ? "font-mono" : ""} ${
          value ? "" : "text-content-muted italic"
        }`}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  href: string;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-lg border border-edge bg-surface-raised p-4 hover:bg-hover transition-colors"
    >
      <Icon size={20} className="text-accent shrink-0" />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">
          {label}
        </p>
        <p className="text-2xl font-semibold text-content font-mono tabular-nums">
          {value}
        </p>
      </div>
    </Link>
  );
}

function PlaceholderCard({
  title,
  hint,
}: {
  title: string;
  hint: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-edge bg-surface-raised/40 p-4">
      <p className="text-sm font-medium text-content-secondary">{title}</p>
      <p className="mt-1 text-xs text-content-muted">{hint}</p>
    </div>
  );
}
