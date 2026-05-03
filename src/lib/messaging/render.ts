/**
 * Template rendering + email-injection sanitization.
 *
 * Two responsibilities:
 *
 *   1. Resolve `%variable%`-style template placeholders against a
 *      data bag the caller assembles (invoice, customer, business).
 *      Mirrors Harvest's template syntax so consultants migrating
 *      from Harvest can paste their existing templates and keep
 *      working.
 *
 *   2. Defend against header injection. The most common email-
 *      sending bug is letting a `\r\n` slip into the subject line:
 *      it lets an attacker inject `Bcc:` (or any header) into the
 *      outbound message. Stripping CR+LF from header-bound strings
 *      (subject, from-name, reply-to) closes that. SAL-016 lineage.
 *
 * Variables are documented in `src/lib/messaging/variables.ts` —
 * adding a new variable requires updating the docs + adding it to
 * the buildVariableBag callers.
 */

/** Inputs the rendering layer needs. The bag is intentionally
 *  narrow so a future variable expansion is just a property add. */
export interface VariableBag {
  /** invoice.invoice_number */
  invoiceId?: string | null;
  invoiceUrl?: string | null;
  invoiceAmount?: string | null;
  invoicePaymentTotal?: string | null;
  invoiceIssueDate?: string | null;
  invoiceDueDate?: string | null;
  invoicePaymentTermsLabel?: string | null;
  customerName?: string | null;
  customerPoNumber?: string | null;
  companyName?: string | null;
  daysPastDue?: number | null;
  /** Net days remaining until due (negative when overdue). */
  daysUntilDue?: number | null;
}

/** Render a string with `%var%` placeholders against a bag. Unknown
 *  variables are left untouched (so a mistyped placeholder is
 *  visible in the output, not silently dropped). */
export function renderTemplate(template: string, bag: VariableBag): string {
  if (!template) return "";
  return template.replace(/%([a-z_]+)%/gi, (match, key: string) => {
    const value = lookup(bag, key);
    if (value == null) return match;
    return String(value);
  });
}

function lookup(bag: VariableBag, key: string): string | number | null {
  switch (key.toLowerCase()) {
    case "invoice_id":
      return bag.invoiceId ?? null;
    case "invoice_url":
      return bag.invoiceUrl ?? null;
    case "invoice_amount":
      return bag.invoiceAmount ?? null;
    case "invoice_payment_total":
      return bag.invoicePaymentTotal ?? null;
    case "invoice_issue_date":
      return bag.invoiceIssueDate ?? null;
    case "invoice_due_date":
      return bag.invoiceDueDate ?? null;
    case "invoice_payment_terms":
      return bag.invoicePaymentTermsLabel ?? null;
    case "customer_name":
    case "client":
    case "invoice_client":
      return bag.customerName ?? null;
    case "customer_po_number":
    case "invoice_po_number":
      return bag.customerPoNumber ?? null;
    case "company_name":
      return bag.companyName ?? null;
    case "days_past_due":
      return bag.daysPastDue ?? null;
    case "days_until_due":
      return bag.daysUntilDue ?? null;
    default:
      return null;
  }
}

/**
 * Strip CR/LF from header-bound strings. Subjects, from-names, and
 * reply-to addresses become headers in the SMTP envelope; a
 * smuggled `\r\n` lets an attacker inject `Bcc: attacker@evil.com`.
 *
 * Replaces line terminators with a single space, collapses runs of
 * whitespace, trims, caps at 998 octets per RFC 5322 §2.1.1
 * (defensive — most providers cap at 256 anyway).
 *
 * Body content is NOT passed through this; line breaks in the body
 * are legitimate and the provider escapes them as MIME content,
 * not headers.
 */
export function sanitizeHeaderValue(value: string): string {
  if (!value) return "";
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 998);
}

/**
 * Email-address validation tuned for outbound recipient lists. Not
 * a perfect RFC 5322 parser — just the pragmatic shape the rest of
 * the industry uses. Intentionally rejects role addresses so a
 * compromised account doesn't blast `noreply@*` and tank the
 * team's domain reputation.
 */
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const ROLE_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "postmaster",
  "abuse",
  "mailer-daemon",
  "bounce",
  "bounces",
]);

/** Returns null on valid; an error code otherwise. */
export function validateRecipient(email: string): null | "invalid" | "role" {
  if (!email || !EMAIL_RE.test(email)) return "invalid";
  if (email.length > 254) return "invalid";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (ROLE_LOCAL_PARTS.has(local)) return "role";
  return null;
}
