"use server";

import { runSafeAction } from "@/lib/safe-action";
import { AppError } from "@/lib/errors";
import { validateTeamAccess } from "@/lib/team-context";
import { revalidatePath } from "next/cache";
import { sendInvoice } from "@/lib/messaging/send-invoice";
import { validateRecipient } from "@/lib/messaging/render";
import { logError } from "@/lib/logger";

/**
 * Action invoked by the Send Invoice modal. Takes the PDF bytes
 * (rendered client-side via the same react-pdf path Download PDF
 * uses), the composed subject/body/recipient list, and dispatches
 * through the messaging module.
 *
 * On success: marks the invoice as `sent`, sets `sent_at`,
 * appends a history row so the activity log surfaces who sent
 * what + when.
 *
 * On send failure: leaves the invoice in its prior status. The
 * outbox row records the failure for forensics; the action throws
 * so the modal surfaces the error inline.
 */
export async function sendInvoiceMessageAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(formData, async (formData, { supabase, userId }) => {
    const invoiceId = formData.get("invoice_id") as string;
    if (!invoiceId) throw new Error("invoice_id is required.");

    const subject = (formData.get("subject") as string) ?? "";
    const bodyText = (formData.get("body_text") as string) ?? "";
    const bodyHtml = (formData.get("body_html") as string) ?? "";
    // To: accepts a single email or comma-separated list (multiple
    // contacts per customer can be flagged invoice recipients —
    // co-owners, AP + CFO pair, etc.). Cc: same shape, separate
    // field. Empty addresses (trailing comma, double comma) are
    // dropped, AND duplicates are removed — `a@x.com, a@x.com`
    // would otherwise send the same person two copies.
    //
    // dedupeAddresses is case-insensitive (Gmail treats
    // FOO@BAR.COM and foo@bar.com as the same mailbox; we follow
    // suit) but preserves the original casing of the first
    // occurrence so the user sees what they typed in the audit
    // trail.
    const toRaw = (formData.get("to_email") as string)?.trim() ?? "";
    const toEmails = dedupeAddresses(
      toRaw ? toRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    );
    const ccRaw = (formData.get("cc_emails") as string)?.trim() ?? "";
    const ccRawList = ccRaw
      ? ccRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    // Cc: drop any address that's already in To: — sending the
    // same person to To and Cc on the same envelope is the kind
    // of doubled-delivery the audit trail needs to NOT lie about.
    const ccEmails = dedupeAddresses(ccRawList).filter(
      (cc) => !addressIn(cc, toEmails),
    );
    const sendCopyToMe = formData.get("send_copy_to_me") === "on";
    const fromOverride = (formData.get("from_email") as string)?.trim() || null;
    const fromNameOverride =
      (formData.get("from_name") as string)?.trim() || null;
    const replyToOverride =
      (formData.get("reply_to_email") as string)?.trim() || null;

    // Look up the invoice + verify team membership before doing
    // any expensive work. Owner/admin only — sending an invoice
    // is a billable-record-touching action.
    const { data: invoice } = await supabase
      .from("invoices")
      .select(
        "id, team_id, customer_id, invoice_number, status, customers(name)",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    if (!invoice) {
      throw AppError.refusal("Invoice not found.");
    }
    const { role } = await validateTeamAccess(invoice.team_id as string);
    if (role !== "owner" && role !== "admin") {
      throw AppError.refusal(
        "Only team owners and admins can send invoices.",
      );
    }
    if (invoice.status === "void") {
      throw AppError.refusal("Voided invoices cannot be sent.");
    }

    // PDF blob from FormData. The client renders it via the same
    // react-pdf path Download PDF uses, then attaches the Blob to
    // the form. We read it as ArrayBuffer → Buffer for the
    // messaging module.
    const pdfFile = formData.get("pdf") as File | null;
    if (!pdfFile) {
      throw new Error("PDF attachment missing.");
    }
    const pdfBytes = Buffer.from(await pdfFile.arrayBuffer());

    // Optional CC of the sender themselves. Solo-consultant review:
    // "I want the paper trail in my own inbox."
    //
    // Validate the sender's email through the same gate every
    // user-supplied recipient passes — `validateRecipient`
    // returns null on success, "invalid" on bad shape, "role" on
    // generic addresses (info@, billing@). A team admin whose
    // own email somehow lands in either bucket should NOT have
    // it silently pushed onto the wire; skip the auto-CC and
    // trust the explicit CC list.
    const finalCc = [...ccEmails];
    if (sendCopyToMe) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      const { data: u } = await admin.auth.admin.getUserById(userId);
      const myEmail = u?.user?.email;
      if (
        myEmail &&
        validateRecipient(myEmail) === null &&
        !addressIn(myEmail, finalCc) &&
        !addressIn(myEmail, toEmails)
      ) {
        finalCc.push(myEmail);
      }
    }

    let providerMessageId: string;
    let outboxId: string;
    try {
      const result = await sendInvoice(supabase, {
        teamId: invoice.team_id as string,
        userId,
        invoiceId: invoice.id as string,
        subject,
        bodyHtml,
        bodyText,
        toEmails,
        ccEmails: finalCc.length > 0 ? finalCc : undefined,
        fromEmailOverride: fromOverride,
        fromNameOverride,
        replyToEmailOverride: replyToOverride,
        pdfBytes,
        pdfFilename: `${invoice.invoice_number ?? "invoice"}.pdf`,
        kind: "invoice",
      });
      providerMessageId = result.providerMessageId;
      outboxId = result.outboxId;
    } catch (err) {
      logError(err, {
        teamId: invoice.team_id as string,
        userId,
        action: "sendInvoiceMessageAction",
      });
      throw err;
    }

    // Mark invoice as sent on the first send only (status flip +
    // sent_at). Re-sends are legal (re-deliver to same customer)
    // but must not overwrite sent_at — that's the audit-trail
    // anchor for the first delivery and downstream period-close
    // queries depend on it being stable.
    //
    // Always update sent_to_email / sent_to_name so the activity
    // log surface (which reads these columns directly) shows the
    // most-recent recipient on every send. The full per-send
    // history lives in `message_outbox` and is rendered as
    // distinct activity events; these summary columns are the
    // top-level signal for "who got this last."
    const customerName =
      invoice.customers &&
      typeof invoice.customers === "object" &&
      "name" in invoice.customers
        ? ((invoice.customers as { name: string | null }).name ?? null)
        : null;
    const updates: Record<string, unknown> = {
      sent_to_email: toEmails.join(", "),
      sent_to_name: customerName,
    };
    if (invoice.status === "draft") {
      updates.status = "sent";
      updates.sent_at = new Date().toISOString();
    }
    await supabase.from("invoices").update(updates).eq("id", invoiceId);

    // Audit-trail signal — the existing invoices_history trigger
    // captures the status flip; the outbox row + provider_message_id
    // give forensic detail when the customer claims they didn't
    // receive it.
    void providerMessageId;
    void outboxId;

    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
  }, "sendInvoiceMessageAction") as unknown as void;
}

/**
 * Drop duplicate email addresses, case-insensitive. Preserves the
 * original casing of the first occurrence so the audit trail
 * carries what the user typed, not a normalized form. Gmail treats
 * `FOO@BAR.COM` and `foo@bar.com` as the same mailbox; we follow
 * suit so the recipient list count matches the bill-of-mail.
 */
function dedupeAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const addr of addresses) {
    const k = addr.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(addr);
  }
  return out;
}

/**
 * Case-insensitive "is this address already in this list?" check.
 * The list is assumed pre-deduped; this is the cross-list
 * filter used to drop To∩Cc collisions and to gate the auto-CC
 * push.
 */
function addressIn(needle: string, haystack: string[]): boolean {
  const k = needle.toLowerCase();
  return haystack.some((a) => a.toLowerCase() === k);
}
