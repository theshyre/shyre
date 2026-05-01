"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import {
  invoicedEntriesRefusalMessage,
  invoicesOnImportedCustomersRefusalMessage,
  manualEntriesOnImportedProjectsRefusalMessage,
  manualProjectsOnImportedCustomersRefusalMessage,
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
    // Force-undo: when explicitly opted in, the manual-data refusal
    // checks (#3 + #4) are skipped. Used by the "Undo anyway" path
    // after the first refusal — the user has read the count and
    // accepts the cascade-delete. Refusals #1 and #2 still fire
    // because those would crash with FK errors mid-transaction
    // (orphan invoices); force can't paper over those.
    const force = formData.get("force") === "true";

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

    // Refusal check 3: manual time entries on imported projects.
    // time_entries.project_id has ON DELETE CASCADE, so when undo
    // deletes a project this run created, every time entry against
    // it gets cascade-deleted by Postgres — including manual entries
    // the user logged AFTER the import. Skipped when `force=true`:
    // the user has read the count and accepts the loss.
    const { data: importedProjects } = await supabase
      .from("projects")
      .select("id")
      .eq("import_run_id", runId);
    const importedProjectIds = (importedProjects ?? []).map(
      (p) => p.id as string,
    );
    if (!force && importedProjectIds.length > 0) {
      const { data: manualEntries } = await supabase
        .from("time_entries")
        .select("project_id")
        .in("project_id", importedProjectIds)
        .or(`import_run_id.is.null,import_run_id.neq.${runId}`);
      if (manualEntries && manualEntries.length > 0) {
        const distinctProjects = new Set(
          manualEntries.map((e) => e.project_id as string),
        );
        throw new Error(
          manualEntriesOnImportedProjectsRefusalMessage(
            manualEntries.length,
            distinctProjects.size,
          ),
        );
      }
    }

    // Refusal check 4: manual projects parented to imported customers.
    // projects.customer_id is ON DELETE CASCADE — a manual project
    // under an imported customer would cascade-delete with the
    // customer, taking its time entries with it. Skipped when
    // `force=true`: the user has read the count and accepts the loss.
    if (!force && importedCustomerIds.length > 0) {
      const { data: manualProjects } = await supabase
        .from("projects")
        .select("customer_id")
        .in("customer_id", importedCustomerIds)
        .or(`import_run_id.is.null,import_run_id.neq.${runId}`);
      if (manualProjects && manualProjects.length > 0) {
        const distinctCustomers = new Set(
          manualProjects.map((p) => p.customer_id as string),
        );
        throw new Error(
          manualProjectsOnImportedCustomersRefusalMessage(
            manualProjects.length,
            distinctCustomers.size,
          ),
        );
      }
    }

    // Delete order matters: invoices BEFORE projects so the
    // time_entries.invoice_id FK SET NULL clears the lock-guard
    // trigger before the project cascade kicks in. The previous
    // order was projects → invoices, which meant project deletion
    // cascade-deleted invoiced time entries; the lock-guard
    // trigger then refused the cascade because the linked invoice
    // was still in 'sent'/'paid' (not yet deleted by us). User
    // hit this on a force-undo where the import had created
    // an invoice the entries were tied to.
    //
    // Final order:
    //   1. expenses  (orphan-safe)
    //   2. time_entries  (rows tagged with this import_run_id;
    //                     pre-undoes the lock-guard's "invoiced"
    //                     check by removing entries we own)
    //   3. invoices  (FK SET NULL on remaining time_entries +
    //                 cascade to invoice_line_items / invoice_payments)
    //   4. categories
    //   5. category_sets
    //   6. projects  (CASCADE may now eat manual time entries
    //                 with invoiced=true / invoice_id=NULL — the
    //                 lock-guard's `OR invoice_id IS NULL` short-
    //                 circuits, so the cascade succeeds)
    //   7. customers
    //
    // Each delete still scopes by team_id so a leaked run_id can't
    // touch another team.
    assertSupabaseOk(
      await supabase
        .from("expenses")
        .delete()
        .eq("team_id", teamId)
        .eq("import_run_id", runId),
    );
    assertSupabaseOk(
      await supabase
        .from("time_entries")
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
    revalidatePath("/business");
  }, "undoImportRunAction") as unknown as void;
}
