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
    invoice_code: string | null;
    customer_id: string | null;
    customers?: { default_rate: number | null } | null;
  } | null;
  categories?: { name: string | null } | null;
}

export default async function NewInvoicePage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("invoices");

  const { data: customers } = await supabase
    .from("customers_v")
    .select("id, name, default_rate, payment_terms_days")
    .eq("archived", false)
    .order("name");

  // Per-customer "where does my last invoice end?" — used by the
  // "Since last invoice" preset on the new form. Pulls the most-
  // recent non-void invoice per customer; period_end wins, else
  // fall back to issued_date for legacy rows that pre-date the
  // period_start / period_end columns. Drafts are deliberately
  // excluded (a draft isn't a customer-facing checkpoint), but
  // sent / paid both count.
  const { data: lastInvoiceRows } = await supabase
    .from("invoices")
    .select("customer_id, period_end, issued_date, status, created_at")
    .not("customer_id", "is", null)
    .neq("status", "void")
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  const lastInvoiceEndByCustomer: Record<string, string> = {};
  for (const row of lastInvoiceRows ?? []) {
    const cid = row.customer_id as string | null;
    if (!cid) continue;
    if (cid in lastInvoiceEndByCustomer) continue; // first wins (newest)
    const end =
      (row.period_end as string | null) ??
      (row.issued_date as string | null) ??
      null;
    if (end) lastInvoiceEndByCustomer[cid] = end;
  }

  const { data: settings } = await supabase
    .from("team_settings_v")
    .select(
      "invoice_prefix, invoice_next_num, tax_rate, default_rate, default_payment_terms_days, business_name",
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
  // Note: don't try to embed `user_profiles!fkey(display_name)` here.
  // PostgREST embedding requires a direct FK between the two tables;
  // both `time_entries.user_id` and `user_profiles.user_id` reference
  // `auth.users(id)` separately, so there's no edge to traverse and
  // the embed errors with PGRST200, leaving the whole query empty
  // (silent breakage — preview shows "no matching entries" even when
  // the customer has billable hours). Display names are fetched in
  // a second query and joined in JS, same shape as memberRows below.
  const teamIds = teams.map((t) => t.id);
  const { data: rawEntries } = teamIds.length
    ? await supabase
        .from("time_entries")
        .select(
          "id, team_id, description, duration_min, start_time, user_id, project_id, projects!inner(name, hourly_rate, invoice_code, customer_id, is_internal, customers(default_rate)), categories(name)",
        )
        .in("team_id", teamIds)
        .eq("invoiced", false)
        .eq("billable", true)
        // Internal-project entries are never invoiceable — exclude
        // them from the preview so they don't show as "candidates"
        // on the new-invoice page. Server action enforces too, but
        // suppressing them here keeps the preview honest.
        .eq("projects.is_internal", false)
        .not("end_time", "is", null)
        .not("duration_min", "is", null)
        .is("deleted_at", null)
        .order("start_time", { ascending: true })
        .limit(5000)
    : { data: [] as RawEntryRow[] };

  // Display names — fetched in one shot for every distinct user_id
  // appearing in the candidate set. The `time-entry authorship`
  // mandate (see CLAUDE.md) requires every surfaced entry carries
  // its author; the preview groups under "By person" rely on this.
  const distinctUserIds = Array.from(
    new Set((rawEntries ?? []).map((r) => r.user_id as string)),
  );
  const { data: profileRows } = distinctUserIds.length
    ? await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", distinctUserIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };
  const displayNameByUserId = new Map<string, string>();
  for (const p of profileRows ?? []) {
    if (p.display_name) {
      displayNameByUserId.set(p.user_id as string, p.display_name as string);
    }
  }

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
      projectInvoiceCode: (proj?.invoice_code as string | null) ?? null,
      customerId: (proj?.customer_id as string | null) ?? null,
      projectId: r.project_id,
      taskName: r.categories?.name ?? null,
      personName: displayNameByUserId.get(r.user_id) ?? "Unknown",
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
        lastInvoiceEndByCustomer={lastInvoiceEndByCustomer}
        defaultTaxRate={settings?.tax_rate ? Number(settings.tax_rate) : 0}
        teamDefaultTermsDays={
          settings?.default_payment_terms_days != null
            ? Number(settings.default_payment_terms_days)
            : null
        }
        previewInvoiceNumber={
          settings?.invoice_prefix && settings?.invoice_next_num != null
            ? `${settings.invoice_prefix}-${String(settings.invoice_next_num).padStart(4, "0")}`
            : null
        }
        businessName={(settings?.business_name as string | null) ?? null}
        teams={teams}
      />
    </div>
  );
}
