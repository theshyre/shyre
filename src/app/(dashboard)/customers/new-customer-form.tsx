"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { AlertBanner, useKeyboardShortcut } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import {
  inputClass,
  textareaClass,
  labelClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { TeamSelector } from "@/components/TeamSelector";
import { AddressFields } from "@/components/AddressFields";
import { FieldError } from "@/components/FieldError";
import { SubmitButton } from "@/components/SubmitButton";
import { customerSchema } from "@/lib/schemas/customer";
import { deserializeAddress } from "@/lib/schemas/address";
import type { TeamListItem } from "@/lib/team-context";
import { createCustomerAction } from "./actions";

export function NewCustomerForm({
  teams,
  defaultTeamId,
}: {
  teams: TeamListItem[];
  defaultTeamId?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const t = useTranslations("customers");
  const tc = useTranslations("common");

  const { pending, success, serverError, fieldErrors, handleSubmit } =
    useFormAction({
      schema: customerSchema,
      action: createCustomerAction,
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
        team_id: fd.get("team_id"),
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
        {t("addCustomer")}
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
      <TeamSelector teams={teams} defaultTeamId={defaultTeamId} />

      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
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
          label={t("saveCustomer")}
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
