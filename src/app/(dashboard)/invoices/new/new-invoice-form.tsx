"use client";

import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
} from "@/lib/form-styles";
import { TeamSelector } from "@/components/TeamSelector";
import type { TeamListItem } from "@/lib/team-context";
import { createInvoiceAction } from "../actions";

interface CustomerOption {
  id: string;
  name: string;
  default_rate: number | null;
}

export function NewInvoiceForm({
  customers,
  defaultTaxRate,
  teams,
}: {
  customers: CustomerOption[];
  defaultTaxRate: number;
  teams: TeamListItem[];
}): React.JSX.Element {
  const t = useTranslations("invoices");

  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: createInvoiceAction,
  });

  return (
    <form
      action={handleSubmit}
      className="mt-6 space-y-4"
    >
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <TeamSelector teams={teams} />
      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
        <p className="text-sm text-content-secondary">
          {t("selectClientDescription")}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("selectClient")}</label>
            <select name="customer_id" className={selectClass}>
              <option value="">All (org-wide)</option>
              {customers.map((c) => (
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

      <SubmitButton label={t("createInvoice")} pending={pending} success={success} icon={FileText} />
    </form>
  );
}
