"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useFormAction } from "@/hooks/use-form-action";
import {
  inputClass,
  textareaClass,
  labelClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { OrgSelector } from "@/components/OrgSelector";
import { AddressFields } from "@/components/AddressFields";
import { FieldError } from "@/components/FieldError";
import { SubmitButton } from "@/components/SubmitButton";
import { clientSchema } from "@/lib/schemas/client";
import { deserializeAddress } from "@/lib/schemas/address";
import type { OrgListItem } from "@/lib/org-context";
import { createClientAction } from "./actions";

export function NewClientForm({
  orgs,
  defaultOrgId,
}: {
  orgs: OrgListItem[];
  defaultOrgId?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const t = useTranslations("clients");
  const tc = useTranslations("common");

  const { pending, success, serverError, fieldErrors, handleSubmit } =
    useFormAction({
      schema: clientSchema,
      action: createClientAction,
      transform: (fd) => ({
        name: fd.get("name"),
        email: fd.get("email") || undefined,
        address: {
          street: fd.get("address.street") || "",
          street2: fd.get("address.street2") || "",
          city: fd.get("address.city") || "",
          state: fd.get("address.state") || "",
          postalCode: fd.get("address.postalCode") || "",
          country: fd.get("address.country") || "",
        },
        notes: fd.get("notes") || undefined,
        default_rate: fd.get("default_rate")
          ? parseFloat(fd.get("default_rate") as string)
          : undefined,
        organization_id: fd.get("organization_id"),
      }),
      onSuccess: () => setOpen(false),
    });

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => setOpen(true), []),
    enabled: !open,
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`${buttonPrimaryClass} mt-4`}
      >
        <Plus size={16} />
        {t("addClient")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  const emptyAddress = deserializeAddress(null);

  return (
    <form
      action={handleSubmit}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      <OrgSelector orgs={orgs} defaultOrgId={defaultOrgId} />

      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t("fields.name")} *</label>
          <input name="name" required className={inputClass} />
          <FieldError error={fieldErrors.name} />
        </div>
        <div>
          <label className={labelClass}>{t("fields.email")}</label>
          <input name="email" type="email" className={inputClass} />
          <FieldError error={fieldErrors.email} />
        </div>
        <div>
          <label className={labelClass}>{t("fields.defaultRate")}</label>
          <input
            name="default_rate"
            type="number"
            step="0.01"
            min="0"
            className={inputClass}
          />
          <FieldError error={fieldErrors.default_rate} />
        </div>
      </div>

      <AddressFields
        prefix="address"
        value={emptyAddress}
        label={t("fields.address")}
        errors={fieldErrors}
      />

      <div>
        <label className={labelClass}>{t("fields.notes")}</label>
        <textarea name="notes" rows={2} className={textareaClass} />
      </div>

      <div className="flex gap-2">
        <SubmitButton
          label={t("saveClient")}
          pending={pending}
          success={success}
          successMessage={tc("actions.save")}
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
