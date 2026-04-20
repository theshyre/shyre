"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { AlertBanner, useKeyboardShortcut } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  labelClass,
  kbdClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { createTeamAction } from "./actions";

export function NewTeamForm(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const tc = useTranslations("common");

  const { pending, serverError, handleSubmit } = useFormAction({
    action: createTeamAction,
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
        {tc("team.create")}
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
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <div>
        <label className={labelClass}>{tc("team.namePlaceholder")} *</label>
        <input
          name="team_name"
          required
          autoFocus
          placeholder={tc("team.namePlaceholder")}
          className={inputClass}
          disabled={pending}
        />
      </div>
      <div className="flex gap-2">
        <SubmitButton
          label={tc("team.create")}
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
