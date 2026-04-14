import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/org-context";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { NewInvoiceForm } from "./new-invoice-form";

export default async function NewInvoicePage(): Promise<React.JSX.Element> {
  const supabase = await createClient();
  const orgs = await getUserOrgs();
  const t = await getTranslations("invoices");

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, default_rate")
    .eq("archived", false)
    .order("name");

  const { data: settings } = await supabase
    .from("organization_settings")
    .select("invoice_prefix, invoice_next_num, tax_rate, default_rate")
    .limit(1)
    .maybeSingle();

  return (
    <div>
      <div className="flex items-center gap-3">
        <FileText size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("createInvoice")}</h1>
      </div>

      <NewInvoiceForm
        customers={customers ?? []}
        defaultTaxRate={settings?.tax_rate ? Number(settings.tax_rate) : 0}
        orgs={orgs}
      />
    </div>
  );
}
