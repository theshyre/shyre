"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  calculateInvoiceTotals,
  generateInvoiceNumber,
} from "@/lib/invoice-utils";
import {
  groupEntriesIntoLineItems,
  type EntryCandidate,
} from "@/lib/invoice-grouping";
import {
  ALLOWED_INVOICE_GROUPING_MODES,
  type InvoiceGroupingMode,
} from "./allow-lists";
import {
  isValidInvoiceStatusTransition,
  type InvoiceStatus,
} from "@/lib/invoice-status";

export async function createInvoiceAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const teamId = formData.get("team_id") as string;
    const { userId, role } = await validateTeamAccess(teamId);

    // Invoice creation is a commercial/administrative action: it touches
    // every team member's billable hours and surfaces team-wide rates.
    // Restrict to owner + admin. A member invoking this would also hit
    // the tight time_entries SELECT (SAL-006) and only see their own
    // rows, producing an incomplete invoice.
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can create invoices.");
    }

    const customer_id = (formData.get("customer_id") as string) || null;
    const notes = (formData.get("notes") as string) || null;
    const due_date = (formData.get("due_date") as string) || null;
    const taxRateStr = formData.get("tax_rate") as string;
    const taxRate = taxRateStr ? parseFloat(taxRateStr) : 0;

    // Date-range filter for billable hours. Both bounds optional;
    // when omitted the action falls back to the legacy "all
    // unbilled" sweep. period_start/end on the invoice row use the
    // explicit form values when set, else the actual min/max of
    // included entry dates (computed below).
    const range_start =
      (formData.get("range_start") as string)?.trim() || null;
    const range_end = (formData.get("range_end") as string)?.trim() || null;

    // Grouping mode — defaults to by_project (US small-business norm
    // per the bookkeeper review). Validated against the allow-list
    // mirrored to the DB CHECK constraint via db-parity.test.ts.
    const groupingRaw =
      (formData.get("grouping_mode") as string)?.trim() || "by_project";
    if (!ALLOWED_INVOICE_GROUPING_MODES.has(groupingRaw)) {
      throw new Error(`Invalid grouping_mode: ${groupingRaw}`);
    }
    const grouping_mode = groupingRaw as InvoiceGroupingMode;

    // Get team settings for invoice number + team-level default rate.
    const { data: settings } = await supabase
      .from("team_settings")
      .select("invoice_prefix, invoice_next_num, default_rate")
      .eq("team_id", teamId)
      .single();

    const prefix = settings?.invoice_prefix ?? "INV";
    const nextNum = settings?.invoice_next_num ?? 1;
    const defaultRate = settings?.default_rate ? Number(settings.default_rate) : 0;

    // Per-member default rate map (the new cascade layer). Base table
    // read is safe here: this action is restricted to owner/admin above,
    // and they're authorized to see every member's rate.
    const { data: memberRows } = await supabase
      .from("team_members")
      .select("user_id, default_rate")
      .eq("team_id", teamId);
    const memberRateByUserId = new Map<string, number | null>(
      (memberRows ?? []).map((m) => [
        m.user_id as string,
        m.default_rate !== null && m.default_rate !== undefined
          ? Number(m.default_rate)
          : null,
      ]),
    );

    // Get unbilled time entries. Pulls the columns needed by the
    // grouping logic + the entry date for period_start / period_end
    // computation. Range filter: when set, exclude entries whose
    // start_time falls outside [range_start, range_end + 1 day).
    let query = supabase
      .from("time_entries")
      .select(
        "id, description, duration_min, project_id, user_id, start_time, projects(name, hourly_rate, customer_id, customers(default_rate)), categories(name), user_profiles!time_entries_user_id_fkey(display_name)",
      )
      .eq("team_id", teamId)
      .eq("invoiced", false)
      .eq("billable", true)
      .not("end_time", "is", null)
      .not("duration_min", "is", null)
      .is("deleted_at", null);
    if (range_start) {
      query = query.gte("start_time", `${range_start}T00:00:00Z`);
    }
    if (range_end) {
      // Inclusive upper bound — add a day so an entry on range_end
      // itself is included regardless of timezone slop.
      const next = new Date(`${range_end}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      query = query.lt("start_time", next.toISOString());
    }

    const { data: entries } = await query;

    // Filter entries based on client selection
    let filteredEntries;
    if (customer_id) {
      // Client invoice: only entries from this client's projects
      filteredEntries = (entries ?? []).filter((e) => {
        const proj = e.projects;
        if (!proj || typeof proj !== "object" || !("customer_id" in proj)) return false;
        return (proj as { customer_id: string | null }).customer_id === customer_id;
      });
    } else {
      // Org-wide invoice: all unbilled entries (including internal projects)
      filteredEntries = entries ?? [];
    }

    if (filteredEntries.length === 0) {
      throw new Error("No unbilled time entries found.");
    }

    // Build per-entry candidates with the rate cascade resolved.
    // Rate cascade (highest non-null wins):
    //   project.hourly_rate
    //     → customer.default_rate
    //       → team_members.default_rate (the user who logged this entry)
    //         → team_settings.default_rate
    const candidates: EntryCandidate[] = filteredEntries.map((entry) => {
      const projRaw = entry.projects;
      const proj =
        projRaw && typeof projRaw === "object" && "name" in projRaw
          ? (projRaw as unknown as {
              name: string;
              hourly_rate: number | null;
              customers: { default_rate: number | null } | null;
            })
          : null;
      const entryUserId = (entry as { user_id: string }).user_id;
      const memberRate = memberRateByUserId.get(entryUserId) ?? null;
      const rate =
        (proj?.hourly_rate ? Number(proj.hourly_rate) : null) ??
        (proj?.customers?.default_rate
          ? Number(proj.customers.default_rate)
          : null) ??
        memberRate ??
        defaultRate;
      const catRaw = (entry as { categories?: unknown }).categories;
      const cat =
        catRaw && typeof catRaw === "object" && "name" in catRaw
          ? (catRaw as { name: string | null })
          : null;
      const profRaw = (entry as { user_profiles?: unknown }).user_profiles;
      const prof =
        profRaw && typeof profRaw === "object" && "display_name" in profRaw
          ? (profRaw as { display_name: string | null })
          : null;
      const startIso = (entry as { start_time: string | null }).start_time;
      return {
        id: entry.id,
        durationMin: Number(entry.duration_min ?? 0),
        rate,
        description: entry.description ?? null,
        projectName: proj?.name ?? "Project",
        taskName: cat?.name ?? null,
        personName: prof?.display_name ?? "Unknown",
        date: startIso ? startIso.slice(0, 10) : "",
      };
    });

    // Group + line-item the candidates. Same logic the live preview
    // runs in the browser, so the user's pre-submit total matches
    // the posted invoice to the cent.
    const groupedLines = groupEntriesIntoLineItems(candidates, grouping_mode);
    const totals = calculateInvoiceTotals(groupedLines, taxRate);
    const invoiceNumber = generateInvoiceNumber(prefix, nextNum);

    // period_start / period_end: prefer the form-supplied bounds when
    // set; else fall back to the actual min/max of included entry
    // dates. Stored explicitly on the invoice row so the PDF + detail
    // page don't have to re-derive on every render.
    const dates = candidates
      .map((c) => c.date)
      .filter((d): d is string => d.length > 0)
      .sort();
    const period_start = range_start ?? dates[0] ?? null;
    const period_end = range_end ?? dates[dates.length - 1] ?? null;

    // Create invoice (customer_id may be null for org-only invoices)
    const invoice = assertSupabaseOk(
      await supabase
        .from("invoices")
        .insert({
          team_id: teamId,
          user_id: userId,
          customer_id,
          invoice_number: invoiceNumber,
          due_date: due_date || null,
          status: "draft",
          subtotal: totals.subtotal,
          tax_rate: totals.taxRate,
          tax_amount: totals.taxAmount,
          total: totals.total,
          notes,
          period_start,
          period_end,
          grouping_mode,
        })
        .select("id")
        .single()
    )!;

    // Create line items. time_entry_id is set only when the line
    // collapses exactly one source entry — for grouped lines (one
    // line covering many entries) the FK has nowhere meaningful to
    // point. The full set of source entry ids lives in the
    // time_entries.invoice_id writeback below.
    const lineItemRows = groupedLines.map((line) => ({
      invoice_id: invoice.id,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      amount: line.amount,
      time_entry_id:
        line.sourceEntryIds.length === 1 ? line.sourceEntryIds[0] : null,
    }));

    assertSupabaseOk(
      await supabase
        .from("invoice_line_items")
        .insert(lineItemRows)
    );

    // Mark every source entry as invoiced — even ones that rolled
    // up into a multi-entry line. That's how the lock chip + the
    // entries-by-invoice-id query find them.
    const entryIds = groupedLines.flatMap((l) => l.sourceEntryIds);
    await supabase
      .from("time_entries")
      .update({ invoiced: true, invoice_id: invoice.id })
      .in("id", entryIds);

    // Increment invoice number
    await supabase
      .from("team_settings")
      .update({ invoice_next_num: nextNum + 1 })
      .eq("team_id", teamId);

    revalidatePath("/invoices");
    revalidatePath("/time-entries");
    redirect(`/invoices/${invoice.id}`);
  }, "createInvoiceAction") as unknown as void;
}

/**
 * Update an invoice's status. Owner/admin only — and only along the
 * allowed transition graph. The DB CHECK constraint validates the
 * *value* (`draft|sent|paid|void|overdue`); this action validates
 * the *transition* (e.g. paid → draft is rejected — that would be
 * a silent unwind of a billed invoice). RLS on invoices_update
 * also enforces owner/admin at the row level.
 */
export async function updateInvoiceStatusAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const nextStatus = formData.get("status") as string;

    if (!id) throw new Error("Invoice id is required.");
    if (!nextStatus) throw new Error("Status is required.");

    // Resolve the team + current status before any role check so
    // the error message is friendlier ("not found" beats a generic
    // role error when the user passed a bad id).
    const { data: row, error: fetchError } = await supabase
      .from("invoices")
      .select("team_id, status")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!row) throw new Error("Invoice not found.");

    const teamId = row.team_id as string;
    const currentStatus = row.status as InvoiceStatus;

    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can change invoice status.");
    }

    if (!isValidInvoiceStatusTransition(currentStatus, nextStatus)) {
      throw new Error(
        `Status change from "${currentStatus}" to "${nextStatus}" is not allowed.`,
      );
    }

    assertSupabaseOk(
      await supabase
        .from("invoices")
        .update({ status: nextStatus })
        .eq("id", id),
    );

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
  }, "updateInvoiceStatusAction") as unknown as void;
}
