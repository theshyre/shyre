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
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { AddressFields } from "@/components/AddressFields";
import { FieldError } from "@/components/FieldError";
import { SubmitButton } from "@/components/SubmitButton";
import { PaymentTermsField } from "@/components/PaymentTermsField";
import { deserializeAddress } from "@/lib/schemas/address";
import { LogoPicker } from "@/components/LogoPicker";
import { updateCustomerAction, setCustomerLogoAction } from "../actions";

interface Client {
  id: string;
  team_id: string;
  name: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  default_rate: number | null;
  payment_terms_days: number | null;
  show_country_on_invoice: boolean | null;
  accent_color: string | null;
  logo_url: string | null;
}

export function CustomerEditForm({
  client,
}: {
  client: Client;
}): React.JSX.Element {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const tPay = useTranslations("paymentTerms");

  const [paymentTermsDays, setPaymentTermsDays] = useState<number | null>(
    client.payment_terms_days,
  );

  const { pending, success, serverError, fieldErrors, handleSubmit } =
    useFormAction({
      onSuccess: () => setFormDirty(false),
      action: updateCustomerAction,
    });
  // Unsaved-changes guard (CLAUDE.md UX rule): any user edit arms the
  // browser's native "Leave page?" confirm until a successful save.
  // Form-level onChange covers the uncontrolled inputs.
  const [formDirty, setFormDirty] = useState(false);
  useUnsavedChanges(formDirty && !pending);


  const address = deserializeAddress(client.address);

  return (
    <form
      action={handleSubmit}
      onChange={() => setFormDirty(true)}
      className="space-y-4"
    >
      <input type="hidden" name="id" value={client.id} />

      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}

      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="customer-edit-name" className={labelClass}>
              {t("fields.name")} *
            </label>
            <input
              id="customer-edit-name"
              name="name"
              required
              defaultValue={client.name}
              className={inputClass}
              aria-describedby={
                fieldErrors.name ? "customer-edit-name-error" : undefined
              }
            />
            <FieldError
              error={fieldErrors.name}
              id="customer-edit-name-error"
            />
          </div>
          <div>
            <label htmlFor="customer-edit-email" className={labelClass}>
              {t("fields.email")}
            </label>
            <input
              id="customer-edit-email"
              name="email"
              type="email"
              defaultValue={client.email ?? ""}
              className={inputClass}
              aria-describedby={
                fieldErrors.email ? "customer-edit-email-error" : undefined
              }
            />
            <FieldError
              error={fieldErrors.email}
              id="customer-edit-email-error"
            />
          </div>
          <div>
            <label htmlFor="customer-edit-default-rate" className={labelClass}>
              {t("fields.defaultRate")}
            </label>
            <input
              id="customer-edit-default-rate"
              name="default_rate"
              type="number"
              step="0.01"
              min="0"
              defaultValue={client.default_rate ?? ""}
              className={inputClass}
              aria-describedby={
                fieldErrors.default_rate
                  ? "customer-edit-default-rate-error"
                  : undefined
              }
            />
            <FieldError
              error={fieldErrors.default_rate}
              id="customer-edit-default-rate-error"
            />
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

        <label className="flex items-start gap-2 text-body-lg font-medium text-content cursor-pointer">
          <input
            name="show_country_on_invoice"
            type="checkbox"
            defaultChecked={client.show_country_on_invoice ?? false}
            className="mt-0.5 h-4 w-4 rounded border-edge text-accent focus:ring-focus-ring"
          />
          <span>
            {t("fields.showCountryOnInvoice")}
            <span className="ml-1 block text-caption font-normal text-content-muted">
              {t("fields.showCountryOnInvoiceHint")}
            </span>
          </span>
        </label>

        <div>
          <label htmlFor="[id]-customer-edit-form-notes" className={labelClass}>{t("fields.notes")}</label>
          <textarea id="[id]-customer-edit-form-notes"
            name="notes"
            rows={3}
            defaultValue={client.notes ?? ""}
            className={textareaClass}
          />
        </div>
      </div>

      {/* Co-brand: the customer's own accent + logo, shown on client-facing
          proposal surfaces alongside the team's brand. */}
      <div className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
        <p className="text-body-lg font-semibold uppercase tracking-wider text-content-muted">
          {t("branding.heading")}
        </p>
        <p className="text-caption text-content-muted">{t("branding.help")}</p>
        <div className="max-w-[220px]">
          <label htmlFor="customer-edit-accent" className={labelClass}>
            {t("fields.accentColor")}
          </label>
          <input
            id="customer-edit-accent"
            name="accent_color"
            type="text"
            defaultValue={client.accent_color ?? ""}
            className={`${inputClass} font-mono`}
            placeholder="#2563EB"
            pattern="^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$"
            aria-describedby={
              fieldErrors.accent_color
                ? "customer-edit-accent-error"
                : undefined
            }
          />
          <FieldError
            error={fieldErrors.accent_color}
            id="customer-edit-accent-error"
          />
        </div>
        <div>
          <p className="mb-2 text-caption font-medium text-content-secondary">
            {t("branding.logoLabel")}
          </p>
          <LogoPicker
            folder={`${client.team_id}/customers/${client.id}`}
            initialUrl={client.logo_url}
            action={setCustomerLogoAction}
            hiddenFields={{ customer_id: client.id }}
            altText={t("branding.logoLabel")}
          />
        </div>
      </div>

      <SubmitButton
        label={t("saveChanges")}
        pending={pending}
        success={success}
        successMessage={tc("actions.saved")}
      />
    </form>
  );
}
