"use client";

import { useTranslations } from "next-intl";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";
import { createInvoiceAction } from "../actions";
import { FileText } from "lucide-react";

interface ClientOption {
  id: string;
  name: string;
  default_rate: number | null;
}

export function NewInvoiceForm({
  clients,
  defaultTaxRate,
}: {
  clients: ClientOption[];
  defaultTaxRate: number;
}): React.JSX.Element {
  const t = useTranslations("invoices");

  return (
    <form
      action={createInvoiceAction}
      className="mt-6 space-y-4"
    >
      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
        <p className="text-sm text-content-secondary">
          {t("selectClientDescription")}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("selectClient")} *</label>
            <select name="client_id" required className={selectClass}>
              <option value="">{t("selectClient")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t("fields.dueDate")}</label>
            <input name="due_date" type="date" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t("fields.taxRate")}</label>
            <input
              name="tax_rate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={defaultTaxRate}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>{t("fields.notes")}</label>
          <textarea
            name="notes"
            rows={3}
            placeholder={t("fields.notesPlaceholder")}
            className={textareaClass}
          />
        </div>
      </div>

      <button type="submit" className={buttonPrimaryClass}>
        <FileText size={16} />
        {t("createInvoice")}
      </button>
    </form>
  );
}
