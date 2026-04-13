"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  inputClass,
  textareaClass,
  labelClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { createClientAction } from "./actions";

export function NewClientForm(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const t = useTranslations("clients");
  const tc = useTranslations("common");

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

  return (
    <form
      action={async (formData) => {
        await createClientAction(formData);
        setOpen(false);
      }}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>{t("fields.name")} *</label>
          <input name="name" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>{t("fields.email")}</label>
          <input name="email" type="email" className={inputClass} />
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
        </div>
        <div>
          <label className={labelClass}>{t("fields.address")}</label>
          <input name="address" className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>{t("fields.notes")}</label>
        <textarea name="notes" rows={2} className={textareaClass} />
      </div>
      <div className="flex gap-2">
        <button type="submit" className={buttonPrimaryClass}>
          {t("saveClient")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonSecondaryClass}
        >
          {tc("actions.cancel")}
        </button>
      </div>
    </form>
  );
}
