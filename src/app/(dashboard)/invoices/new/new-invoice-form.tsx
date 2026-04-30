"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { useDirtyTitle } from "@/hooks/use-dirty-title";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
  formGridClass,
  formSpanFull,
  formSpanHalf,
  formSpanQuarter,
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

  // Track whether the user has touched any field. The dirty bullet
  // (• Page · Shyre) appears in the browser tab so a user with
  // many tabs can spot the in-flight invoice draft. Cleared on a
  // successful submit. Defensive — fires on any change/input event
  // so checkboxes, selects, textareas all flip it.
  const [dirty, setDirty] = useState(false);
  useDirtyTitle(dirty);

  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: createInvoiceAction,
    onSuccess: () => setDirty(false),
  });

  return (
    <form
      action={handleSubmit}
      onChange={() => {
        if (!dirty) setDirty(true);
      }}
      onInput={() => {
        if (!dirty) setDirty(true);
      }}
      className="mt-6 space-y-4"
    >
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <TeamSelector teams={teams} />
      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
        <p className="text-body text-content-secondary">
          {t("selectClientDescription")}
        </p>

        {/* 12-col grid — Customer is the hero (col-span-6); Due Date
            and Tax Rate are compact (col-span-3 each). Notes
            full-width below. See docs/reference/forms-and-buttons.md
            → "Field sizing". */}
        <div className={formGridClass}>
          <div className={formSpanHalf}>
            <label className={labelClass}>{t("selectClient")}</label>
            <select
              autoFocus
              name="customer_id"
              defaultValue=""
              className={selectClass}
            >
              <option value="">{t("allClients")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={formSpanQuarter}>
            <label className={labelClass}>{t("fields.dueDate")}</label>
            <input name="due_date" type="date" className={inputClass} />
          </div>
          <div className={formSpanQuarter}>
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
          <div className={formSpanFull}>
            <label className={labelClass}>{t("fields.notes")}</label>
            <textarea
              name="notes"
              rows={3}
              placeholder={t("fields.notesPlaceholder")}
              className={textareaClass}
            />
          </div>
        </div>
      </div>

      <SubmitButton label={t("createInvoice")} pending={pending} success={success} icon={FileText} />
    </form>
  );
}
