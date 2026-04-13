"use server";

import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client_id = formData.get("client_id") as string;
  const notes = (formData.get("notes") as string) || null;
  const due_date = (formData.get("due_date") as string) || null;
  const taxRateStr = formData.get("tax_rate") as string;
  const taxRate = taxRateStr ? parseFloat(taxRateStr) : 0;

  // Get user settings for invoice number
  const { data: settings } = await supabase
    .from("user_settings")
    .select("invoice_prefix, invoice_next_num, default_rate")
    .eq("user_id", user.id)
    .single();

  const prefix = settings?.invoice_prefix ?? "INV";
  const nextNum = settings?.invoice_next_num ?? 1;
  const defaultRate = settings?.default_rate ? Number(settings.default_rate) : 0;

  // Get unbilled time entries for this client
  const { data: entries } = await supabase
    .from("time_entries")
    .select("id, description, duration_min, project_id, projects(name, hourly_rate, client_id, clients(default_rate))")
    .eq("invoiced", false)
    .eq("billable", true)
    .not("end_time", "is", null)
    .not("duration_min", "is", null);

  // Filter to entries belonging to this client's projects
  const clientEntries = (entries ?? []).filter((e) => {
    const proj = e.projects;
    if (!proj || typeof proj !== "object") return false;
    if (!("client_id" in proj)) return false;
    return (proj as { client_id: string }).client_id === client_id;
  });

  if (clientEntries.length === 0) {
    throw new Error("No unbilled time entries found for this client.");
  }

  // Build line items
  const lineItems: (LineItemResult & { time_entry_id: string })[] =
    clientEntries.map((entry) => {
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

  // Create invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      user_id: user.id,
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
    .single();

  if (invoiceError || !invoice) {
    throw new Error(invoiceError?.message ?? "Failed to create invoice");
  }

  // Create line items
  const lineItemRows = lineItems.map((item) => ({
    invoice_id: invoice.id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    amount: item.amount,
    time_entry_id: item.time_entry_id,
  }));

  const { error: lineError } = await supabase
    .from("invoice_line_items")
    .insert(lineItemRows);

  if (lineError) throw new Error(lineError.message);

  // Mark time entries as invoiced
  const entryIds = lineItems.map((item) => item.time_entry_id);
  await supabase
    .from("time_entries")
    .update({ invoiced: true, invoice_id: invoice.id })
    .in("id", entryIds);

  // Increment invoice number
  await supabase
    .from("user_settings")
    .update({ invoice_next_num: nextNum + 1 })
    .eq("user_id", user.id);

  revalidatePath("/invoices");
  revalidatePath("/time-entries");
  redirect(`/invoices/${invoice.id}`);
}

export async function updateInvoiceStatusAction(
  formData: FormData
): Promise<void> {
  const supabase = await createClient();
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;

  const { error } = await supabase
    .from("invoices")
    .update({ status })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
}
