/**
 * Refusal-message builders for `undoImportRunAction`.
 *
 * Extracted here so the (surprisingly bug-prone) pluralization + count
 * math can be unit-tested directly, without pulling the Supabase /
 * server-action runtime. The server action calls these and throws an
 * Error with the returned string when a block condition holds.
 */

export function invoicedEntriesRefusalMessage(
  entryCount: number,
  invoiceCount: number,
): string {
  const entryText = entryCount === 1 ? "entry is" : "entries are";
  const invoiceText = invoiceCount === 1 ? "invoice" : "invoices";
  const voidText =
    invoiceCount === 1 ? "that invoice" : "those invoices";
  return `${entryCount} imported time ${entryText} attached to ${invoiceCount} ${invoiceText}. Void or delete ${voidText} first, then try undo again.`;
}

export function invoicesOnImportedCustomersRefusalMessage(
  invoiceCount: number,
): string {
  const invoiceText = invoiceCount === 1 ? "invoice" : "invoices";
  const verbText = invoiceCount === 1 ? "references" : "reference";
  return `${invoiceCount} ${invoiceText} ${verbText} an imported customer. Delete or void those invoices before undoing this import.`;
}

/**
 * Manual (non-imported) time entries logged against projects that this
 * run created. A naive delete-by-import_run_id would *cascade-delete*
 * those manual entries via the time_entries → projects FK; refuse
 * instead so the user can re-home them first.
 *
 * Includes the count of distinct projects so the user can scope the
 * cleanup ("8 manual entries on 2 projects" → "open those 2 projects
 * and review what's there").
 */
export function manualEntriesOnImportedProjectsRefusalMessage(
  entryCount: number,
  projectCount: number,
): string {
  const entryText = entryCount === 1 ? "manual time entry" : "manual time entries";
  const projectText = projectCount === 1 ? "project" : "projects";
  const verbText = entryCount === 1 ? "exists" : "exist";
  const onText = projectCount === 1 ? "a project" : `${projectCount} ${projectText}`;
  return `${entryCount} ${entryText} ${verbText} on ${onText} this import created. Move ${entryCount === 1 ? "it" : "them"} to another project first, or you'll lose ${entryCount === 1 ? "it" : "them"} when the project is deleted.`;
}

/**
 * Manual (non-imported) projects parented to a customer this run
 * created. Deleting the customer cascades through projects — and
 * through their time entries — so refuse and tell the user to
 * re-parent the projects first.
 */
export function manualProjectsOnImportedCustomersRefusalMessage(
  projectCount: number,
  customerCount: number,
): string {
  const projectText = projectCount === 1 ? "manual project" : "manual projects";
  const customerText = customerCount === 1 ? "customer" : "customers";
  const verbText = projectCount === 1 ? "is" : "are";
  const onText =
    customerCount === 1 ? "a customer" : `${customerCount} ${customerText}`;
  return `${projectCount} ${projectText} ${verbText} parented to ${onText} this import created. Move ${projectCount === 1 ? "it" : "them"} to another customer first, or you'll lose ${projectCount === 1 ? "it" : "them"} along with everything logged against ${projectCount === 1 ? "it" : "them"}.`;
}
