import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserTeams } from "@/lib/team-context";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { NewInvoiceForm } from "./new-invoice-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("newInvoice") };
}

export default async function NewInvoicePage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const teams = await getUserTeams();
  const t = await getTranslations("invoices");

  const { data: customers } = await supabase
    .from("customers_v")
    .select("id, name, default_rate")
    .eq("archived", false)
    .order("name");

  const { data: settings } = await supabase
    .from("team_settings_v")
    .select("invoice_prefix, invoice_next_num, tax_rate, default_rate")
    .limit(1)
    .maybeSingle();

  return (
    <div>
      <div className="flex items-center gap-3">
        <FileText size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("createInvoice")}</h1>
      </div>

      <NewInvoiceForm
        customers={customers ?? []}
        defaultTaxRate={settings?.tax_rate ? Number(settings.tax_rate) : 0}
        teams={teams}
      />
    </div>
  );
}
