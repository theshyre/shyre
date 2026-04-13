"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  inputClass,
  labelClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { createOrgAction } from "./actions";

export function NewOrgForm(): React.JSX.Element {
  const [open, setOpen] = useState(false);
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
        {tc("org.create")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  return (
    <form
      action={async (formData) => {
        await createOrgAction(formData);
        setOpen(false);
      }}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      <div>
        <label className={labelClass}>{tc("org.namePlaceholder")} *</label>
        <input
          name="org_name"
          required
          autoFocus
          placeholder={tc("org.namePlaceholder")}
          className={inputClass}
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" className={buttonPrimaryClass}>
          {tc("org.create")}
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
