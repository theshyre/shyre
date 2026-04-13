import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { BarChart3 } from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";

interface ClientSummary {
  name: string;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  revenue: number;
}

interface ProjectSummary {
  name: string;
  clientName: string;
  totalMinutes: number;
  billableMinutes: number;
  entryCount: number;
  rate: number;
  revenue: number;
}

export default async function ReportsPage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const t = await getTranslations("reports");

  // Fetch all time entries with project and client info
  const { data: entries } = await supabase
    .from("time_entries")
    .select("duration_min, billable, projects(name, hourly_rate, clients(name, default_rate))")
    .not("end_time", "is", null)
    .not("duration_min", "is", null);

  // Get user's default rate
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: settings } = await supabase
    .from("user_settings")
    .select("default_rate")
    .eq("user_id", user?.id ?? "")
    .single();
  const defaultRate = settings?.default_rate ? Number(settings.default_rate) : 0;

  // Aggregate by client
  const clientMap = new Map<string, ClientSummary>();
  const projectMap = new Map<string, ProjectSummary>();

  for (const entry of entries ?? []) {
    const proj = entry.projects as unknown as {
      name: string;
      hourly_rate: number | null;
      clients: { name: string; default_rate: number | null } | null;
    } | null;

    const clientName = proj?.clients?.name ?? "Unknown";
    const projectName = proj?.name ?? "Unknown";
    const mins = entry.duration_min ?? 0;
    const isBillable = entry.billable ?? false;
    const rate =
      (proj?.hourly_rate ? Number(proj.hourly_rate) : null) ??
      (proj?.clients?.default_rate ? Number(proj.clients.default_rate) : null) ??
      defaultRate;
    const hours = mins / 60;
    const entryRevenue = isBillable ? hours * rate : 0;

    // Client aggregation
    const existing = clientMap.get(clientName);
    if (existing) {
      existing.totalMinutes += mins;
      if (isBillable) existing.billableMinutes += mins;
      existing.entryCount += 1;
      existing.revenue += entryRevenue;
    } else {
      clientMap.set(clientName, {
        name: clientName,
        totalMinutes: mins,
        billableMinutes: isBillable ? mins : 0,
        entryCount: 1,
        revenue: entryRevenue,
      });
    }

    // Project aggregation
    const projKey = `${clientName}::${projectName}`;
    const existingProj = projectMap.get(projKey);
    if (existingProj) {
      existingProj.totalMinutes += mins;
      if (isBillable) existingProj.billableMinutes += mins;
      existingProj.entryCount += 1;
      existingProj.revenue += entryRevenue;
    } else {
      projectMap.set(projKey, {
        name: projectName,
        clientName,
        totalMinutes: mins,
        billableMinutes: isBillable ? mins : 0,
        entryCount: 1,
        rate,
        revenue: entryRevenue,
      });
    }
  }

  const clientSummaries = Array.from(clientMap.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes
  );
  const projectSummaries = Array.from(projectMap.values()).sort(
    (a, b) => b.totalMinutes - a.totalMinutes
  );

  const totalMinutes = clientSummaries.reduce((s, c) => s + c.totalMinutes, 0);
  const totalBillable = clientSummaries.reduce((s, c) => s + c.billableMinutes, 0);
  const totalRevenue = clientSummaries.reduce((s, c) => s + c.revenue, 0);
  const billablePercent = totalMinutes > 0 ? Math.round((totalBillable / totalMinutes) * 100) : 0;

  const fmtHours = (mins: number): string => `${(mins / 60).toFixed(1)}h`;

  return (
    <div>
      <div className="flex items-center gap-3">
        <BarChart3 size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("title")}</h1>
      </div>

      {/* Summary cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <SummaryCard label={t("totals.totalHours")} value={fmtHours(totalMinutes)} />
        <SummaryCard label={t("table.billableHours")} value={fmtHours(totalBillable)} />
        <SummaryCard label={t("totals.totalRevenue")} value={formatCurrency(Math.round(totalRevenue * 100) / 100)} />
        <SummaryCard label={t("totals.billablePercent")} value={`${billablePercent}%`} />
      </div>

      {clientSummaries.length === 0 ? (
        <p className="mt-8 text-sm text-content-muted">{t("noData")}</p>
      ) : (
        <>
          {/* Hours by Client */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-content">
              {t("sections.byClient")}
            </h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge bg-surface-inset">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.name")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.hours")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.billableHours")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.revenue")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.entries")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clientSummaries.map((c) => (
                    <tr
                      key={c.name}
                      className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-content">
                        {c.name}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(c.totalMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(c.billableMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content">
                        {formatCurrency(Math.round(c.revenue * 100) / 100)}
                      </td>
                      <td className="px-4 py-3 text-right text-content-secondary">
                        {c.entryCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-edge bg-surface-inset">
                    <td className="px-4 py-3 font-semibold text-content">
                      {t("totals.total")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-content">
                      {fmtHours(totalMinutes)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-content">
                      {fmtHours(totalBillable)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-content">
                      {formatCurrency(Math.round(totalRevenue * 100) / 100)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-content">
                      {clientSummaries.reduce((s, c) => s + c.entryCount, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Hours by Project */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-content">
              {t("sections.byProject")}
            </h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-edge bg-surface-raised">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge bg-surface-inset">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.name")}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-content-muted">
                      Client
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.hours")}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-content-muted">
                      {t("table.revenue")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projectSummaries.map((p) => (
                    <tr
                      key={`${p.clientName}::${p.name}`}
                      className="border-b border-edge last:border-0 hover:bg-hover transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-content">
                        {p.name}
                      </td>
                      <td className="px-4 py-3 text-content-secondary">
                        {p.clientName}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content-secondary">
                        {fmtHours(p.totalMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-content">
                        {formatCurrency(Math.round(p.revenue * 100) / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold font-mono text-content">{value}</p>
    </div>
  );
}
