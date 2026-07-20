"use client";

import { createContext, useCallback, useContext, useState } from "react";
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

/**
 * Shared open/closed state between the header-cluster trigger and the
 * inline-expansion form body. Per list-pages.md rule 2, only the
 * trigger lives in the header Row 1; the expanded form keeps
 * rendering below it — so the two live in different subtrees of the
 * (server) page and need a client context to share the toggle.
 * Mirrors projects/new-project-form.tsx's NewProjectFormProvider.
 */
interface NewTeamFormState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const NewTeamFormContext = createContext<NewTeamFormState | null>(null);

export function NewTeamFormProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <NewTeamFormContext.Provider value={{ open, setOpen }}>
      {children}
    </NewTeamFormContext.Provider>
  );
}

function useNewTeamForm(): NewTeamFormState {
  const ctx = useContext(NewTeamFormContext);
  if (!ctx) {
    throw new Error(
      "AddTeamTrigger / NewTeamForm must render inside <NewTeamFormProvider>",
    );
  }
  return ctx;
}

/**
 * The header-cluster primary action: `[Plus] Create Team [kbd N]`
 * (list-pages.md rule 2). Toggles the inline-expansion form rendered
 * by <NewTeamForm>.
 */
export function AddTeamTrigger(): React.JSX.Element {
  const { open, setOpen } = useNewTeamForm();
  const tc = useTranslations("common");

  useKeyboardShortcut({
    key: "n",
    onTrigger: useCallback(() => setOpen(true), [setOpen]),
    enabled: !open,
  });

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-controls={open ? "new-team-form" : undefined}
      className={buttonPrimaryClass}
    >
      <Plus size={16} />
      {tc("team.create")}
      <kbd className={kbdClass}>N</kbd>
    </button>
  );
}

export function NewTeamForm(): React.JSX.Element | null {
  const { open, setOpen } = useNewTeamForm();
  const tc = useTranslations("common");

  const { pending, serverError, handleSubmit } = useFormAction({
    action: createTeamAction,
    onSuccess: () => setOpen(false),
  });

  if (!open) return null;

  return (
    <form
      id="new-team-form"
      action={handleSubmit}
      className="mt-4 space-y-3 rounded-lg border border-edge bg-surface-raised p-4"
    >
      {serverError && (
        <AlertBanner tone="error">{serverError}</AlertBanner>
      )}
      <div>
        <label htmlFor="new-team-name" className={labelClass}>
          {tc("team.namePlaceholder")} *
        </label>
        <input
          id="new-team-name"
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
          label={tc("team.createSubmit")}
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
