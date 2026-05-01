import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { NewInvoiceForm } from "./new-invoice-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("newInvoice") };
}

interface RawEntryRow {
  id: string;
  team_id: string;
  description: string | null;
  duration_min: number | null;
  start_time: string | null;
  user_id: string;
  project_id: string;
  projects: {
    name: string | null;
    hourly_rate: number | null;
    customer_id: string | null;
    customers?: { default_rate: number | null } | null;
  } | null;
  categories?: { name: string | null } | null;
  user_profiles?: { display_name: string | null } | null;
}

export default async function NewInvoicePage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("invoices");

  const { data: customers } = await supabase
    .from("customers_v")
    .select("id, name, default_rate")
    .eq("archived", false)
    .order("name");

  const { data: settings } = await supabase
    .from("team_settings_v")
    .select(
      "invoice_prefix, invoice_next_num, tax_rate, default_rate",
    )
    .limit(1)
    .maybeSingle();

  // Pre-fetch every uninvoiced billable entry the user can see, so
  // the live-preview rail can filter / group / sum client-side
  // without a server round-trip per keystroke. Bookkeeper review
  // pinned this: the preview total must match the posted total to
  // the cent, so the data + grouping logic has to match what
  // createInvoiceAction will run at submit. Caps at 5,000 to keep
  // the payload reasonable; if a customer has more than 5k
  // uninvoiced entries the form will show a warning and the user
  // should narrow with a date range first.
  const teamIds = teams.map((t) => t.id);
  const { data: rawEntries } = teamIds.length
    ? await supabase
        .from("time_entries")
        .select(
          "id, team_id, description, duration_min, start_time, user_id, project_id, projects(name, hourly_rate, customer_id, customers(default_rate)), categories(name), user_profiles!time_entries_user_id_fkey(display_name)",
        )
        .in("team_id", teamIds)
        .eq("invoiced", false)
        .eq("billable", true)
        .not("end_time", "is", null)
        .not("duration_min", "is", null)
        .is("deleted_at", null)
        .order("start_time", { ascending: true })
        .limit(5000)
    : { data: [] as RawEntryRow[] };

  // Resolve member rates so the rate cascade can run client-side
  // matching the action's resolution. Owner/admin only on this
  // page (action enforces) — surfacing rates here is OK.
  const { data: memberRows } = teamIds.length
    ? await supabase
        .from("team_members")
        .select("user_id, default_rate, team_id")
        .in("team_id", teamIds)
    : { data: [] };

  const teamDefaultRate = settings?.default_rate
    ? Number(settings.default_rate)
    : 0;

  // Normalize embedded relations + resolve the rate cascade per entry
  // up front so the preview only handles primitive shapes.
  const memberRateByUserAndTeam = new Map<string, number | null>();
  for (const m of memberRows ?? []) {
    const k = `${m.team_id}:${m.user_id}`;
    memberRateByUserAndTeam.set(
      k,
      m.default_rate !== null && m.default_rate !== undefined
        ? Number(m.default_rate)
        : null,
    );
  }

  // Build the customer-id list separately so the preview can filter
  // without re-walking project rows.
  const candidates = (rawEntries ?? []).map((row) => {
    const r = row as unknown as RawEntryRow & { team_id: string };
    const proj = r.projects ?? null;
    const memberRate =
      memberRateByUserAndTeam.get(`${r.team_id}:${r.user_id}`) ?? null;
    const rate =
      (proj?.hourly_rate != null ? Number(proj.hourly_rate) : null) ??
      (proj?.customers?.default_rate != null
        ? Number(proj.customers.default_rate)
        : null) ??
      memberRate ??
      teamDefaultRate;
    return {
      id: r.id,
      durationMin: Number(r.duration_min ?? 0),
      rate,
      description: r.description ?? null,
      projectName: proj?.name ?? "Project",
      customerId: (proj?.customer_id as string | null) ?? null,
      taskName: r.categories?.name ?? null,
      personName: r.user_profiles?.display_name ?? "Unknown",
      teamId: r.team_id,
      date:
        r.start_time && r.start_time.length >= 10
          ? r.start_time.slice(0, 10)
          : "",
    };
  });

  return (
    <div>
      <div className="flex items-center gap-3">
        <FileText size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("createInvoice")}</h1>
      </div>

      <NewInvoiceForm
        customers={customers ?? []}
        candidates={candidates}
        defaultTaxRate={settings?.tax_rate ? Number(settings.tax_rate) : 0}
        teams={teams}
      />
    </div>
  );
}
