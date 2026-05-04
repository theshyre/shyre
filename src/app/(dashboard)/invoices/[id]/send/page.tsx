import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { validateTeamAccess } from "@/lib/team-context";
import { isTeamAdmin } from "@/lib/team-roles";
import { loadInvoiceSendBundle } from "@/lib/invoices/send-bundle";
import { SendInvoiceForm } from "./send-invoice-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("invoice_number")
    .eq("id", id)
    .maybeSingle();
  const t = await getTranslations("messaging.send");
  return {
    title: invoice?.invoice_number
      ? `${t("pageTitle")} · ${invoice.invoice_number as string}`
      : t("pageTitle"),
  };
}

/**
 * /invoices/[id]/send — Send Invoice composer.
 *
 * Promoted from a centered modal to a real route after the modal
 * dismissed-on-backdrop-click cost users their composed messages.
 * Three a11y / UX wins from the route shape: native page navigation
 * handles focus reset and history; useUnsavedChanges triggers the
 * browser's "Leave page?" confirm without portal/trap bookkeeping;
 * the URL is shareable + refresh-survivable.
 *
 * Server component does the data fetch via loadInvoiceSendBundle
 * (the same data path the legacy modal consumed via props).
 * Client form (SendInvoiceForm) renders the PDF in-browser via
 * @react-pdf/renderer right before dispatch — same shape Download
 * PDF uses.
 *
 * Owner / admin only — sending is a billable-record-touching
 * action. Members get notFound() rather than a 403, matching how
 * the legacy SendInvoiceButton was hidden for them on the parent
 * page (the visible affordance never appeared, so a deep-link to
 * /send shouldn't reveal one).
 */
export default async function SendInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await createClient();
  const t = await getTranslations("messaging.send");

  const bundle = await loadInvoiceSendBundle(supabase, id);
  if (!bundle) notFound();

  const { role } = await validateTeamAccess(bundle.teamId);
  if (!isTeamAdmin(role)) notFound();

  if (bundle.status === "void") {
    return (
      <div className="space-y-4">
        <BackLink invoiceId={id} t={t} />
        <h1 className="text-page-title font-bold text-content">
          {t("pageTitle")}
        </h1>
        <div className="rounded-md border border-error/40 bg-error-soft px-4 py-3 text-body text-content flex items-center gap-2">
          <AlertCircle size={16} className="text-error shrink-0" />
          {t("voidNotSendable")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BackLink invoiceId={id} t={t} />
      <div>
        <h1 className="text-page-title font-bold text-content">
          {t("pageTitle")}
        </h1>
        <p className="mt-1 text-body text-content-secondary">
          {bundle.invoiceNumber
            ? t("pageSubtitle", { invoiceNumber: bundle.invoiceNumber })
            : t("pageSubtitleGeneric")}
        </p>
      </div>

      {(bundle.configMissing || bundle.domainNotVerified) && (
        <div className="rounded-md border border-warning/40 bg-warning-soft/40 px-4 py-3 text-body text-content flex items-start gap-2">
          <AlertCircle size={16} className="text-warning mt-0.5 shrink-0" />
          <div>
            {bundle.configMissing
              ? t("previewMissingConfig", { teamId: bundle.teamId })
              : t("previewMissingDomain", {
                  address: bundle.fromEmail ?? "",
                  teamId: bundle.teamId,
                })}
          </div>
        </div>
      )}

      <SendInvoiceForm
        invoiceId={bundle.invoiceId}
        teamId={bundle.teamId}
        defaultTo={bundle.defaultTo}
        defaultFromEmail={bundle.fromEmail}
        defaultFromName={bundle.fromName}
        defaultReplyTo={bundle.replyTo}
        defaultSubject={bundle.renderedSubject}
        defaultBody={bundle.renderedBody}
        signature={bundle.signature}
        configMissing={bundle.configMissing}
        domainNotVerified={bundle.domainNotVerified}
        pdfBundle={bundle.pdfBundle}
        backHref={`/invoices/${id}`}
      />
    </div>
  );
}

function BackLink({
  invoiceId,
  t,
}: {
  invoiceId: string;
  t: (key: string) => string;
}): React.JSX.Element {
  return (
    <Link
      href={`/invoices/${invoiceId}`}
      className="inline-flex items-center gap-1.5 text-caption text-content-muted hover:text-content"
    >
      <ArrowLeft size={12} />
      {t("backToInvoice")}
    </Link>
  );
}
