import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { validateTeamAccess } from "@/lib/team-context";
import { EmailConfigForm } from "./email-config-form";
import { DomainVerification } from "./domain-verification";
import { TemplateEditor } from "./template-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("messaging");
  return { title: t("page.title") };
}

const DEFAULT_INVOICE_SEND_TEMPLATE = {
  subject: "Invoice %invoice_id% from %company_name%",
  body: `Hello,

Please find invoice %invoice_id% attached.

Invoice ID: %invoice_id%
Issue date: %invoice_issue_date%
Customer: %customer_name%
Amount: %invoice_amount%
Due: %invoice_due_date% (%invoice_payment_terms%)

You can also view the invoice online: %invoice_url%

Thanks,
%company_name%`,
};

export default async function TeamEmailSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id: teamId } = await params;
  const supabase = await createClient();
  const t = await getTranslations("messaging");

  // Owner / admin only — non-privileged callers get notFound() per
  // SAL-013 lineage (don't leak the existence of the page).
  const { role } = await validateTeamAccess(teamId);
  if (role !== "owner" && role !== "admin") notFound();

  const [{ data: config }, { data: domains }, { data: settings }, { data: templates }] =
    await Promise.all([
      supabase
        .from("team_email_config")
        .select(
          "from_email, from_name, reply_to_email, signature, daily_cap, daily_sent_count, daily_window_starts_at, api_key_encrypted",
        )
        .eq("team_id", teamId)
        .maybeSingle(),
      supabase
        .from("verified_email_domains")
        .select(
          "id, domain, status, dns_records, verified_at, last_checked_at, failure_reason",
        )
        .eq("team_id", teamId)
        .order("created_at", { ascending: false }),
      supabase
        .from("team_settings")
        .select("business_name")
        .eq("team_id", teamId)
        .maybeSingle(),
      supabase
        .from("message_templates")
        .select("kind, subject, body")
        .eq("team_id", teamId),
    ]);

  // Surface presence-only of the API key — never the ciphertext.
  // The form treats "has key" as a checkbox-like state and lets the
  // user paste a replacement.
  const hasApiKey = Boolean(config?.api_key_encrypted);

  // Default template falls back when the team hasn't customized.
  // Same default lives in the renderer's send path so what the
  // editor shows is what the actual send would use.
  const invoiceSendTemplate =
    (templates ?? []).find((t) => t.kind === "invoice_send") ??
    DEFAULT_INVOICE_SEND_TEMPLATE;

  const businessName = (settings?.business_name as string | null) ?? "Your business";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Mail size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">
          {t("page.title")}
        </h1>
      </div>
      <p className="text-body text-content-secondary max-w-2xl">
        {t("page.intro", { business: businessName })}
      </p>

      <EmailConfigForm
        teamId={teamId}
        initial={{
          fromEmail: (config?.from_email as string | null) ?? "",
          fromName: (config?.from_name as string | null) ?? businessName,
          replyToEmail: (config?.reply_to_email as string | null) ?? "",
          signature: (config?.signature as string | null) ?? "",
          dailyCap: Number(config?.daily_cap ?? 50),
          hasApiKey,
        }}
        usage={{
          dailySent: Number(config?.daily_sent_count ?? 0),
          dailyCap: Number(config?.daily_cap ?? 50),
        }}
      />

      <DomainVerification
        teamId={teamId}
        domains={(domains ?? []).map((d) => ({
          id: d.id as string,
          domain: d.domain as string,
          status: (d.status as "pending" | "verified" | "failed") ?? "pending",
          dnsRecords: (d.dns_records as Array<{
            type: string;
            name: string;
            value: string;
            purpose: string;
          }> | null) ?? [],
          verifiedAt: (d.verified_at as string | null) ?? null,
          lastCheckedAt: (d.last_checked_at as string | null) ?? null,
          failureReason: (d.failure_reason as string | null) ?? null,
        }))}
        hasApiKey={hasApiKey}
      />

      <TemplateEditor
        teamId={teamId}
        kind="invoice_send"
        initial={{
          subject: (invoiceSendTemplate.subject as string) ?? DEFAULT_INVOICE_SEND_TEMPLATE.subject,
          body: (invoiceSendTemplate.body as string) ?? DEFAULT_INVOICE_SEND_TEMPLATE.body,
        }}
      />
    </div>
  );
}
