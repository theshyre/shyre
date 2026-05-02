"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertBanner } from "@theshyre/ui";
import {
  inputClass,
  textareaClass,
  labelClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { AddressFields } from "@/components/AddressFields";
import { FieldError } from "@/components/FieldError";
import { SubmitButton } from "@/components/SubmitButton";
import { PaymentTermsField } from "@/components/PaymentTermsField";
import { deserializeAddress } from "@/lib/schemas/address";
import { updateCustomerAction } from "../actions";

interface Client {
  id: string;
  name: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  default_rate: number | null;
  payment_terms_days: number | null;
}

export function CustomerEditForm({
  client,
}: {
  client: Client;
}): React.JSX.Element {
  const t = useTranslations("customers");
  const tPay = useTranslations("paymentTerms");

  const [paymentTermsDays, setPaymentTermsDays] = useState<number | null>(
    client.payment_terms_days,
  );

  const { pending, success, serverError, fieldErrors, handleSubmit } =
    useFormAction({
      action: updateCustomerAction,
    });

  const address = deserializeAddress(client.address);

  return (
    <form action={handleSubmit} className="space-y-4">
      <input type="hidden" name="id" value={client.id} />

      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}

      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{t("fields.name")} *</label>
            <input
              name="name"
              required
              defaultValue={client.name}
              className={inputClass}
            />
            <FieldError error={fieldErrors.name} />
          </div>
          <div>
            <label className={labelClass}>{t("fields.email")}</label>
            <input
              name="email"
              type="email"
              defaultValue={client.email ?? ""}
              className={inputClass}
            />
            <FieldError error={fieldErrors.email} />
          </div>
          <div>
            <label className={labelClass}>{t("fields.defaultRate")}</label>
            <input
              name="default_rate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={client.default_rate ?? ""}
              className={inputClass}
            />
            <FieldError error={fieldErrors.default_rate} />
          </div>
        </div>

        <div>
          <PaymentTermsField
            name="payment_terms_days"
            value={paymentTermsDays}
            onChange={setPaymentTermsDays}
            label={tPay("label")}
            inheritLabel={tPay("customer.inheritLabel")}
            helperText={tPay("customer.helper")}
          />
          <FieldError error={fieldErrors.payment_terms_days} />
        </div>

        <AddressFields
          prefix="address"
          value={address}
          label={t("fields.address")}
          errors={fieldErrors}
        />

        <div>
          <label className={labelClass}>{t("fields.notes")}</label>
          <textarea
            name="notes"
            rows={3}
            defaultValue={client.notes ?? ""}
            className={textareaClass}
          />
        </div>
      </div>

      <SubmitButton
        label={t("saveChanges")}
        pending={pending}
        success={success}
        successMessage="Saved"
      />
    </form>
  );
}
