"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import {
  invoicedEntriesRefusalMessage,
  invoicesOnImportedCustomersRefusalMessage,
} from "./undo-refusal";

/**
 * Undo an import run: hard-delete every row that carries this
 * `import_run_id` and mark the run's record as undone.
 *
 * Ownership: verified two ways — `validateTeamAccess` blocks on team
 * membership with owner/admin role, and the `team_id` on the fetched
 * import_runs row must match. Belt + suspenders, since hard-deleting
 * a run scoped to the wrong team would be a real incident.
 *
 * Refusal cases — we do NOT proceed if any of the imported data is
 * now load-bearing for other records the user has built on top of:
 *   - an imported time entry has `invoice_id` set pointing to an
 *     invoice that is NOT part of this same run (an invoice from
 *     this run gets cleaned up alongside, so it doesn't block)
 *   - an imported customer has non-imported invoices pointing at it
 *     (or invoices from a different run, which would orphan)
 *
 * The user is told what to clean up first. Blocking here is better
 * than leaving stranded invoices or line items; voiding/deleting an
 * invoice is a deliberate action that should come from the user.
 */
export async function undoImportRunAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const runId = formData.get("run_id") as string;
    const teamId = formData.get("team_id") as string;

    if (!runId || !teamId) {
      throw new Error("run_id and team_id are required.");
    }

    const { role } = await validateTeamAccess(teamId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only team owners and admins can undo import runs.");
    }

    // Fetch the run to confirm it belongs to this team AND hasn't
    // already been undone.
    const { data: run, error: runFetchError } = await supabase
      .from("import_runs")
      .select("id, team_id, undone_at")
      .eq("id", runId)
      .maybeSingle();

    if (runFetchError || !run) {
      throw new Error("Import run not found.");
    }
    if ((run.team_id as string) !== teamId) {
      throw new Error("Import run does not belong to this team.");
    }
    if (run.undone_at) {
      throw new Error("This import has already been undone.");
    }

    // Refusal check 1: time entries linked to invoices that are NOT
    // part of this same run. Invoices imported by this run will be
    // cleaned up alongside, so the entry-to-invoice link is safe to
    // tear down. A pre-existing or different-run invoice on an
    // imported entry is real user data — block.
    const { data: invoicedEntries } = await supabase
      .from("time_entries")
      .select("id, invoice_id")
      .eq("import_run_id", runId)
      .not("invoice_id", "is", null);
    if (invoicedEntries && invoicedEntries.length > 0) {
      const linkedInvoiceIds = Array.from(
        new Set(invoicedEntries.map((e) => e.invoice_id as string)),
      );
      const { data: sameRunInvoices } = await supabase
        .from("invoices")
        .select("id")
        .in("id", linkedInvoiceIds)
        .eq("import_run_id", runId);
      const sameRunInvoiceIds = new Set(
        (sameRunInvoices ?? []).map((i) => i.id as string),
      );
      const blockingInvoiceIds = linkedInvoiceIds.filter(
        (id) => !sameRunInvoiceIds.has(id),
      );
      if (blockingInvoiceIds.length > 0) {
        const blockingEntryCount = invoicedEntries.filter((e) =>
          blockingInvoiceIds.includes(e.invoice_id as string),
        ).length;
        throw new Error(
          invoicedEntriesRefusalMessage(
            blockingEntryCount,
            blockingInvoiceIds.length,
          ),
        );
      }
    }

    // Refusal check 2: invoices pointing at imported customers, where
    // the invoice itself is NOT part of this run. Invoices.customer_id
    // has no ON DELETE CASCADE, so deleting an imported customer that
    // a non-imported invoice points at would fail with an FK error
    // mid-transaction. Block early with a clear message instead.
    const { data: importedCustomers } = await supabase
      .from("customers")
      .select("id")
      .eq("import_run_id", runId);
    const importedCustomerIds = (importedCustomers ?? []).map(
      (c) => c.id as string,
    );
    if (importedCustomerIds.length > 0) {
      const { count: invoicesOnImportedCustomers } = await supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .in("customer_id", importedCustomerIds)
        .or(`import_run_id.is.null,import_run_id.neq.${runId}`);

      if ((invoicesOnImportedCustomers ?? 0) > 0) {
        throw new Error(
          invoicesOnImportedCustomersRefusalMessage(
            invoicesOnImportedCustomers ?? 0,
          ),
        );
      }
    }

    // Delete in FK order: time_entries → categories → category_sets →
    // projects → invoices (cascades to invoice_line_items) → customers.
    // Each delete scopes by team_id too, so even a leaked run_id can't
    // touch another team.
    assertSupabaseOk(
      await supabase
        .from("time_entries")
        .delete()
        .eq("team_id", teamId)
        .eq("import_run_id", runId),
    );
    assertSupabaseOk(
      await supabase
        .from("categories")
        .delete()
        .eq("import_run_id", runId),
    );
    assertSupabaseOk(
      await supabase
        .from("category_sets")
        .delete()
        .eq("team_id", teamId)
        .eq("import_run_id", runId),
    );
    assertSupabaseOk(
      await supabase
        .from("projects")
        .delete()
        .eq("team_id", teamId)
        .eq("import_run_id", runId),
    );
    assertSupabaseOk(
      await supabase
        .from("invoices")
        .delete()
        .eq("team_id", teamId)
        .eq("import_run_id", runId),
    );
    assertSupabaseOk(
      await supabase
        .from("customers")
        .delete()
        .eq("team_id", teamId)
        .eq("import_run_id", runId),
    );

    assertSupabaseOk(
      await supabase
        .from("import_runs")
        .update({
          undone_at: new Date().toISOString(),
          undone_by_user_id: userId,
        })
        .eq("id", runId),
    );

    revalidatePath("/import");
    revalidatePath("/customers");
    revalidatePath("/projects");
    revalidatePath("/time-entries");
    revalidatePath("/invoices");
  }, "undoImportRunAction") as unknown as void;
}
