"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
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

  const { pending, serverError, handleSubmit } = useFormAction({
    action: createOrgAction,
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
        {tc("org.create")}
        <kbd className={kbdClass}>N</kbd>
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      {serverError && (
        <p className="text-sm text-error bg-error-soft rounded-lg px-3 py-2">
          {serverError}
        </p>
      )}
      <div>
        <label className={labelClass}>{tc("org.namePlaceholder")} *</label>
        <input
          name="org_name"
          required
          autoFocus
          placeholder={tc("org.namePlaceholder")}
          className={inputClass}
          disabled={pending}
        />
      </div>
      <div className="flex gap-2">
        <SubmitButton
          label={tc("org.create")}
          pending={pending}
          icon={Plus}
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
