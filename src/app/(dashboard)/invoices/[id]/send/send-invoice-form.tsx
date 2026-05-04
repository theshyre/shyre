"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Send,
  Eye,
  FileText,
  Mail,
  Paperclip,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/InvoicePDF";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import {
  inputClass,
  textareaClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  kbdClass,
} from "@/lib/form-styles";
import { sendInvoiceMessageAction } from "../send-invoice-action";
import type { PdfBundle } from "@/lib/invoices/send-bundle";

interface Props {
  invoiceId: string;
  teamId: string;
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
  /** Where Cancel returns the user. Always `/invoices/[id]` for now;
   *  passed in so a future "send from list" entry point can route
   *  somewhere else without hard-coding. */
  backHref: string;
}

/**
 * Send Invoice composer (route-page version).
 *
 * Layout (per the solo-consultant + UX review of the legacy modal):
 *
 *   [Compose | Preview]                            (tabs)
 *
 *   To: ___________________________________
 *   Subject: _______________________________  ←  full-width, above body
 *   Body:
 *   ┌──────────────────────────────────────┐
 *   │ ...                                   │
 *   │ ...                                   │
 *   │ -- signature appended automatically   │ ← inline at the textarea base
 *   │ Marcus / Malcom IO                    │
 *   │ 503-555-0123                          │
 *   └──────────────────────────────────────┘
 *
 *   ▸ Show Cc / Reply-To             (collapsed by default)
 *
 *   [ ] Send a copy to me                    Cancel  [Send ⌘↵]
 *
 * Visual weight matches edit frequency: Subject is full-width above
 * Body (high-edit), Cc / Reply-To are tucked behind a disclosure
 * (low-edit). Signature renders read-only at the textarea bottom so
 * the user always sees what's actually being sent.
 *
 * Composing changes are guarded by useUnsavedChanges → the browser's
 * native "Leave page?" prompt fires on tab close / refresh. On
 * successful send the dirty flag clears + the route navigates back
 * to the invoice.
 */
export function SendInvoiceForm(props: Props): React.JSX.Element {
  const t = useTranslations("messaging.send");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"compose" | "preview">("compose");
  const [to, setTo] = useState(props.defaultTo);
  const [cc, setCc] = useState("");
  const [replyTo, setReplyTo] = useState(props.defaultReplyTo ?? "");
  const [showOptional, setShowOptional] = useState(false);
  const [fromEmail] = useState(props.defaultFromEmail ?? "");
  const [fromName] = useState(props.defaultFromName ?? "");
  const [subject, setSubject] = useState(props.defaultSubject);
  const [body, setBody] = useState(props.defaultBody);
  const [sendCopyToMe, setSendCopyToMe] = useState(true);
  const [pending, startTransition] = useTransition();
  // The form starts at the bundle defaults; user edits set this.
  // Cleared on successful send so the back-navigation doesn't trip
  // the unsaved-changes prompt on the way out.
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useUnsavedChanges(dirty && !pending);

  function markDirty<T>(setter: (v: T) => void): (v: T) => void {
    return (v) => {
      setter(v);
      setDirty(true);
    };
  }

  // Cmd/Ctrl + Enter submits — same shortcut email composers use.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") {
          // Already inside a form field — let the default submit.
        }
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const composedBody = useMemo(() => {
    const sig = props.signature.trim();
    if (!sig) return body;
    return `${body.trimEnd()}\n\n${sig}`;
  }, [body, props.signature]);

  async function buildPdfBlob(): Promise<Blob> {
    const b = props.pdfBundle;
    const i = b.invoice;
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
        // Clear dirty BEFORE navigating so the beforeunload guard
        // doesn't fire on the success route push.
        setDirty(false);
        router.push(props.backHref);
      } catch (err) {
        toast.push({
          kind: "error",
          message: err instanceof Error ? err.message : t("sendFailed"),
        });
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="rounded-lg border border-edge bg-surface-raised"
    >
      <div className="flex gap-1 border-b border-edge px-4 pt-2">
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

      <div className="p-4 space-y-4">
        {tab === "compose" ? (
          <>
            <div>
              <label className={labelClass} htmlFor="to_email">
                {t("to")}
              </label>
              <input
                id="to_email"
                type="text"
                required
                value={to}
                onChange={(e) => markDirty(setTo)(e.target.value)}
                className={inputClass}
                placeholder="customer@example.com"
                aria-describedby="to_email_hint"
                autoFocus
              />
              <p
                id="to_email_hint"
                className="mt-1 text-caption text-content-muted"
              >
                {t("toHint")}
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="subject">
                {t("subject")}
              </label>
              <input
                id="subject"
                type="text"
                required
                value={subject}
                onChange={(e) => markDirty(setSubject)(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="body">
                {t("body")}
              </label>
              <textarea
                id="body"
                required
                rows={12}
                value={body}
                onChange={(e) => markDirty(setBody)(e.target.value)}
                className={textareaClass}
              />
              {props.signature && (
                <div className="mt-2 rounded-md border border-edge bg-surface px-3 py-2 text-caption text-content-secondary">
                  <div className="font-medium text-content-muted uppercase tracking-wider text-[10px] mb-1">
                    {t("signaturePreview")}
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-body text-content-secondary">
                    {props.signature}
                  </pre>
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowOptional((s) => !s)}
                className="inline-flex items-center gap-1 text-caption text-content-secondary hover:text-content"
                aria-expanded={showOptional}
                aria-controls="optional-fields"
              >
                {showOptional ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                {showOptional
                  ? t("hideOptional")
                  : t("showOptional")}
              </button>
              {showOptional && (
                <div
                  id="optional-fields"
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                >
                  <div>
                    <label className={labelClass} htmlFor="cc_emails">
                      {t("cc")}
                    </label>
                    <input
                      id="cc_emails"
                      type="text"
                      value={cc}
                      onChange={(e) => markDirty(setCc)(e.target.value)}
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
                      onChange={(e) => markDirty(setReplyTo)(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-body text-content-secondary">
              <input
                type="checkbox"
                checked={sendCopyToMe}
                onChange={(e) =>
                  markDirty(setSendCopyToMe)(e.target.checked)
                }
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
          <Link
            href={props.backHref}
            className={buttonSecondaryClass}
            aria-disabled={pending}
            onClick={(e) => {
              if (pending) e.preventDefault();
            }}
          >
            {tCommon("actions.cancel")}
          </Link>
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
      </div>
    </form>
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
      aria-pressed={active}
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
        <PreviewRow
          label="From"
          value={fromName ? `${fromName} <${fromEmail}>` : fromEmail}
        />
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
