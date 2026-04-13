"use client";

import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import {
  inputClass,
  textareaClass,
  labelClass,
} from "@/lib/form-styles";
import { useFormAction } from "@/hooks/use-form-action";
import { AddressFields } from "@/components/AddressFields";
import { FieldError } from "@/components/FieldError";
import { SubmitButton } from "@/components/SubmitButton";
import { deserializeAddress } from "@/lib/schemas/address";
import { updateClientAction } from "../actions";

interface Client {
  id: string;
  name: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  default_rate: number | null;
}

export function ClientEditForm({
  client,
}: {
  client: Client;
}): React.JSX.Element {
  const t = useTranslations("clients");

  const { pending, success, serverError, fieldErrors, handleSubmit } =
    useFormAction({
      action: updateClientAction,
    });

  const address = deserializeAddress(client.address);

  return (
    <form action={handleSubmit} className="space-y-4">
      <input type="hidden" name="id" value={client.id} />

      <div className="flex items-center gap-3">
        <Users size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">{t("editTitle")}</h1>
      </div>

      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {serverError}
        </p>
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
