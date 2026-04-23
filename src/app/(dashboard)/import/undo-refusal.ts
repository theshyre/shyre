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
