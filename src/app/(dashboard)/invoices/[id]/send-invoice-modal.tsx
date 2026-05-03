"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Send, X, Eye, FileText, Mail, Paperclip } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/InvoicePDF";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import {
  inputClass,
  textareaClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  kbdClass,
} from "@/lib/form-styles";
import { sendInvoiceMessageAction } from "./send-invoice-action";

/**
 * Send Invoice composition modal.
 *
 * Compose tab: subject + body + To/Cc/Reply-To + variable sidebar.
 * Preview tab: rendered HTML body + attachment chip + meta.
 *
 * On Send: client renders the invoice PDF via @react-pdf/renderer
 * (same path as Download PDF), bundles it with the form data, and
 * dispatches `sendInvoiceMessageAction`. Cmd+Enter submits.
 *
 * The `defaultSubject` / `defaultBody` strings the page passes in
 * are already variable-resolved (so the user sees actual values,
 * not %placeholders%). The user can still edit.
 */

interface PdfBundle {
  /** Loose-shaped invoice row from the page query. Fields the
   *  InvoicePDF component needs are picked at render time below. */
  invoice: Record<string, unknown>;
  lineItems: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
  client: {
    name: string;
    email: string | null;
    address: string | null;
    show_country_on_invoice: boolean | null;
  } | null;
  business: {
    business_name: string | null;
    business_email: string | null;
    business_address: string | null;
    business_phone: string | null;
    wordmark_primary: string | null;
    wordmark_secondary: string | null;
    brand_color: string | null;
    show_country_on_invoice: boolean | null;
  } | null;
  paymentsTotal: number;
  invoiceNumber: string;
  paymentTermsLabel: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  teamId: string;
  invoiceId: string;
  defaultTo: string;
  defaultFromEmail: string | null;
  defaultFromName: string | null;
  defaultReplyTo: string | null;
  defaultSubject: string;
  defaultBody: string;
  signature: string;
  configMissing: boolean;
  domainNotVerified: boolean;
  pdfBundle: PdfBundle;
}

export function SendInvoiceModal(props: Props): React.JSX.Element | null {
  const t = useTranslations("messaging.send");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const [tab, setTab] = useState<"compose" | "preview">("compose");
  const [to, setTo] = useState(props.defaultTo);
  const [cc, setCc] = useState("");
  const [replyTo, setReplyTo] = useState(props.defaultReplyTo ?? "");
  const [fromEmail] = useState(props.defaultFromEmail ?? "");
  const [fromName] = useState(props.defaultFromName ?? "");
  const [subject, setSubject] = useState(props.defaultSubject);
  const [body, setBody] = useState(props.defaultBody);
  const [sendCopyToMe, setSendCopyToMe] = useState(true);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!props.open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") props.onClose();
      // Cmd/Ctrl + Enter submits, mirroring email composer convention.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const composedBody = useMemo(() => {
    const sig = props.signature.trim();
    if (!sig) return body;
    return `${body.trimEnd()}\n\n${sig}`;
  }, [body, props.signature]);

  async function buildPdfBlob(): Promise<Blob> {
    const b = props.pdfBundle;
    const i = b.invoice as Record<string, unknown>;
    const doc = (
      <InvoicePDF
        invoiceNumber={b.invoiceNumber}
        issuedDate={(i.issued_date as string | null) ?? null}
        dueDate={(i.due_date as string | null) ?? null}
        notes={(i.notes as string | null) ?? null}
        subtotal={Number(i.subtotal ?? 0)}
        status={(i.status as string | null) ?? undefined}
        discountAmount={Number(i.discount_amount ?? 0)}
        discountRate={
          i.discount_rate !== null && i.discount_rate !== undefined
            ? Number(i.discount_rate)
            : null
        }
        taxRate={Number(i.tax_rate ?? 0)}
        taxAmount={Number(i.tax_amount ?? 0)}
        total={Number(i.total ?? 0)}
        paymentsTotal={b.paymentsTotal}
        paymentTermsLabel={b.paymentTermsLabel}
        currency={(i.currency as string | null) ?? "USD"}
        business={{
          name: b.business?.business_name ?? null,
          email: b.business?.business_email ?? null,
          address: b.business?.business_address ?? null,
          phone: b.business?.business_phone ?? null,
          wordmarkPrimary: b.business?.wordmark_primary ?? null,
          wordmarkSecondary: b.business?.wordmark_secondary ?? null,
          brandColor: b.business?.brand_color ?? null,
          showCountry: b.business?.show_country_on_invoice ?? false,
        }}
        client={{
          name: b.client?.name ?? "Client",
          email: b.client?.email ?? null,
          address: b.client?.address ?? null,
          showCountry: b.client?.show_country_on_invoice ?? false,
        }}
        lineItems={b.lineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unit_price,
          amount: li.amount,
        }))}
      />
    );
    return await pdf(doc).toBlob();
  }

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    startTransition(async () => {
      try {
        const pdfBlob = await buildPdfBlob();
        const fd = new FormData();
        fd.set("invoice_id", props.invoiceId);
        fd.set("to_email", to.trim());
        fd.set("cc_emails", cc.trim());
        fd.set("subject", subject);
        fd.set("body_text", composedBody);
        // For Phase 1 we ship plain text only; HTML body is the
        // text body wrapped in <pre> for monospace rendering.
        fd.set(
          "body_html",
          `<pre style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; white-space: pre-wrap;">${escapeHtml(composedBody)}</pre>`,
        );
        fd.set("from_email", fromEmail);
        fd.set("from_name", fromName);
        fd.set("reply_to_email", replyTo);
        if (sendCopyToMe) fd.set("send_copy_to_me", "on");
        fd.set("pdf", pdfBlob, `${props.pdfBundle.invoiceNumber}.pdf`);

        await assertActionResult(sendInvoiceMessageAction(fd));
        toast.push({ kind: "success", message: t("sent") });
        props.onClose();
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("sendFailed"),
        });
      }
    });
  }

  if (!props.open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-invoice-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-content/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) props.onClose();
      }}
    >
      <div className="w-full max-w-[820px] max-h-[90vh] overflow-y-auto rounded-lg border border-edge bg-surface-raised shadow-lg">
        <div className="flex items-start justify-between border-b border-edge px-5 py-3">
          <div>
            <h2
              id="send-invoice-title"
              className="text-title font-semibold text-content"
            >
              {t("modalTitle")}
            </h2>
            <p className="mt-0.5 text-caption text-content-muted">
              {t("modalSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            disabled={pending}
            aria-label={tCommon("actions.close")}
            className="inline-flex items-center rounded-md p-1 text-content-muted hover:bg-hover hover:text-content"
          >
            <X size={16} />
          </button>
        </div>

        {(props.configMissing || props.domainNotVerified) && (
          <div className="border-b border-edge bg-warning-soft/40 px-5 py-3 text-body text-content">
            {props.configMissing
              ? t("previewMissingConfig", { teamId: props.teamId })
              : t("previewMissingDomain", {
                  address: props.defaultFromEmail ?? "",
                  teamId: props.teamId,
                })}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-edge px-5 pt-2">
          <TabButton
            active={tab === "compose"}
            onClick={() => setTab("compose")}
            icon={Mail}
            label={t("tabCompose")}
          />
          <TabButton
            active={tab === "preview"}
            onClick={() => setTab("preview")}
            icon={Eye}
            label={t("tabPreview")}
          />
        </div>

        <form ref={formRef} onSubmit={onSubmit} className="p-5 space-y-3">
          {tab === "compose" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="to_email">
                    {t("to")}
                  </label>
                  <input
                    id="to_email"
                    type="email"
                    required
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="cc_emails">
                    {t("cc")}
                  </label>
                  <input
                    id="cc_emails"
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    className={inputClass}
                    placeholder="alice@acme.com, bob@acme.com"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="reply_to_email">
                    {t("replyTo")}
                  </label>
                  <input
                    id="reply_to_email"
                    type="email"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>{t("subject")}</label>
                  <input
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="body">
                  {t("body")}
                </label>
                <textarea
                  id="body"
                  required
                  rows={10}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className={textareaClass}
                />
                {props.signature && (
                  <p className="mt-1 text-caption text-content-muted whitespace-pre-line">
                    <span className="font-medium">Signature: </span>
                    {props.signature}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-body text-content-secondary">
                <input
                  type="checkbox"
                  checked={sendCopyToMe}
                  onChange={(e) => setSendCopyToMe(e.target.checked)}
                  className="h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
                />
                {t("sendCopyToMe")}
              </label>
            </>
          ) : (
            <PreviewPane
              subject={subject}
              body={composedBody}
              to={to}
              cc={cc}
              replyTo={replyTo}
              fromEmail={fromEmail}
              fromName={fromName}
              attachmentLabel={`${props.pdfBundle.invoiceNumber}.pdf`}
              t={t}
            />
          )}

          <div className="flex items-center justify-end gap-2 border-t border-edge pt-3">
            <button
              type="button"
              onClick={props.onClose}
              disabled={pending}
              className={buttonSecondaryClass}
            >
              {tCommon("actions.cancel")}
            </button>
            <button
              type="submit"
              disabled={
                pending || props.configMissing || props.domainNotVerified
              }
              className={buttonPrimaryClass}
            >
              <Send size={14} />
              {pending ? t("sending") : t("sendButton")}
              <span className={kbdClass}>{t("kbdSend")}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-body transition-colors ${
        active
          ? "border-x border-t border-edge bg-surface-raised text-content -mb-px"
          : "text-content-muted hover:text-content"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function PreviewPane({
  subject,
  body,
  to,
  cc,
  replyTo,
  fromEmail,
  fromName,
  attachmentLabel,
  t,
}: {
  subject: string;
  body: string;
  to: string;
  cc: string;
  replyTo: string;
  fromEmail: string;
  fromName: string;
  attachmentLabel: string;
  t: (key: string) => string;
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-edge bg-surface p-3 space-y-1 text-body">
        <PreviewRow label="From" value={fromName ? `${fromName} <${fromEmail}>` : fromEmail} />
        <PreviewRow label="To" value={to} />
        {cc && <PreviewRow label="Cc" value={cc} />}
        {replyTo && <PreviewRow label="Reply-To" value={replyTo} />}
        <PreviewRow label={t("previewSubject")} value={subject} bold />
      </div>
      <div className="rounded-md border border-edge bg-surface p-3">
        <p className="mb-2 text-label uppercase tracking-wider text-content-muted">
          {t("previewBody")}
        </p>
        <pre className="whitespace-pre-wrap font-sans text-body text-content">
          {body}
        </pre>
      </div>
      <div className="rounded-md border border-edge bg-surface p-3 flex items-center gap-2 text-body">
        <Paperclip size={14} className="text-content-muted" />
        <span className="text-content-muted">{t("previewAttachment")}:</span>
        <span className="font-mono">{attachmentLabel}</span>
        <FileText size={14} className="text-error" />
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-content-muted">{label}:</span>
      <span className={bold ? "font-semibold text-content" : "text-content"}>
        {value}
      </span>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
