"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateOrgAccess } from "@/lib/org-context";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  calculateLineItemAmount,
  calculateInvoiceTotals,
  generateInvoiceNumber,
  minutesToHours,
} from "@/lib/invoice-utils";
import type { LineItemResult } from "@/lib/invoice-utils";

export async function createInvoiceAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const orgId = formData.get("organization_id") as string;
    const { userId } = await validateOrgAccess(orgId);

    const client_id = (formData.get("client_id") as string) || null;
    const notes = (formData.get("notes") as string) || null;
    const due_date = (formData.get("due_date") as string) || null;
    const taxRateStr = formData.get("tax_rate") as string;
    const taxRate = taxRateStr ? parseFloat(taxRateStr) : 0;

    // Get org settings for invoice number
    const { data: settings } = await supabase
      .from("organization_settings")
      .select("invoice_prefix, invoice_next_num, default_rate")
      .eq("organization_id", orgId)
      .single();

    const prefix = settings?.invoice_prefix ?? "INV";
    const nextNum = settings?.invoice_next_num ?? 1;
    const defaultRate = settings?.default_rate ? Number(settings.default_rate) : 0;

    // Get unbilled time entries — filter by client if specified, otherwise all org entries
    const query = supabase
      .from("time_entries")
      .select("id, description, duration_min, project_id, projects(name, hourly_rate, client_id, clients(default_rate))")
      .eq("organization_id", orgId)
      .eq("invoiced", false)
      .eq("billable", true)
      .not("end_time", "is", null)
      .not("duration_min", "is", null);

    const { data: entries } = await query;

    // Filter entries based on client selection
    let filteredEntries;
    if (client_id) {
      // Client invoice: only entries from this client's projects
      filteredEntries = (entries ?? []).filter((e) => {
        const proj = e.projects;
        if (!proj || typeof proj !== "object" || !("client_id" in proj)) return false;
        return (proj as { client_id: string | null }).client_id === client_id;
      });
    } else {
      // Org-wide invoice: all unbilled entries (including internal projects)
      filteredEntries = entries ?? [];
    }

    if (filteredEntries.length === 0) {
      throw new Error("No unbilled time entries found.");
    }

    // Build line items
    const lineItems: (LineItemResult & { time_entry_id: string })[] =
      filteredEntries.map((entry) => {
        const projRaw = entry.projects;
        const proj = projRaw && typeof projRaw === "object" && "name" in projRaw
          ? (projRaw as unknown as {
              name: string;
              hourly_rate: number | null;
              clients: { default_rate: number | null } | null;
            })
          : null;
        const hours = minutesToHours(entry.duration_min ?? 0);
        const rate =
          (proj?.hourly_rate ? Number(proj.hourly_rate) : null) ??
          (proj?.clients?.default_rate ? Number(proj.clients.default_rate) : null) ??
          defaultRate;
        const amount = calculateLineItemAmount(hours, rate);
        const desc = entry.description
          ? `${proj?.name ?? "Project"}: ${entry.description}`
          : (proj?.name ?? "Project work");

        return {
          description: desc,
          quantity: hours,
          unitPrice: rate,
          amount,
          time_entry_id: entry.id,
        };
      });

    const totals = calculateInvoiceTotals(lineItems, taxRate);
    const invoiceNumber = generateInvoiceNumber(prefix, nextNum);

    // Create invoice (client_id may be null for org-only invoices)
    const invoice = assertSupabaseOk(
      await supabase
        .from("invoices")
        .insert({
          organization_id: orgId,
          user_id: userId,
          client_id,
          invoice_number: invoiceNumber,
          due_date: due_date || null,
          status: "draft",
          subtotal: totals.subtotal,
          tax_rate: totals.taxRate,
          tax_amount: totals.taxAmount,
          total: totals.total,
          notes,
        })
        .select("id")
        .single()
    )!;

    // Create line items
    const lineItemRows = lineItems.map((item) => ({
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      amount: item.amount,
      time_entry_id: item.time_entry_id,
    }));

    assertSupabaseOk(
      await supabase
        .from("invoice_line_items")
        .insert(lineItemRows)
    );

    // Mark time entries as invoiced
    const entryIds = lineItems.map((item) => item.time_entry_id);
    await supabase
      .from("time_entries")
      .update({ invoiced: true, invoice_id: invoice.id })
      .in("id", entryIds);

    // Increment invoice number
    await supabase
      .from("organization_settings")
      .update({ invoice_next_num: nextNum + 1 })
      .eq("organization_id", orgId);

    revalidatePath("/invoices");
    revalidatePath("/time-entries");
    redirect(`/invoices/${invoice.id}`);
  }, "createInvoiceAction") as unknown as void;
}

export async function updateInvoiceStatusAction(formData: FormData): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase }) => {
    const id = formData.get("id") as string;
    const status = formData.get("status") as string;

    assertSupabaseOk(
      await supabase
        .from("invoices")
        .update({ status })
        .eq("id", id)
    );

    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
  }, "updateInvoiceStatusAction") as unknown as void;
}
