"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCheck, CheckCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormAction } from "@/hooks/use-form-action";
import { bulkStripButtonClass } from "@/lib/table-styles";
import { resolveAllErrorsAction } from "./actions";

/**
 * Header-level "Resolve all", scoped to the page's active filter.
 * Resolving is a reversible-ish one-way flip done in bulk, so it takes
 * a tier-1 inline [Confirm][Cancel] (forms-and-buttons.md tiers;
 * pattern reference: projects' bulk close-out) instead of firing on
 * first click. Focus moves to Confirm when armed so the keyboard
 * journey survives the trigger being replaced.
 */
export function ResolveAllButton({
  severity,
  count,
}: {
  /** Active severity filter, or null when unscoped (Unresolved / All). */
  severity: "error" | "warning" | "info" | null;
  /** Unresolved rows the sweep would resolve (for the confirm label). */
  count: number;
}): React.JSX.Element {
  const t = useTranslations("admin.errorLog");
  const tc = useTranslations("common.actions");
  const [armed, setArmed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { pending, success, handleSubmit } = useFormAction({
    action: resolveAllErrorsAction,
    onSuccess: () => setArmed(false),
  });

  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  if (success) {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption text-success">
        <CheckCircle size={14} aria-hidden="true" />
        {t("resolveAllSuccess")}
      </span>
    );
  }

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={bulkStripButtonClass}
      >
        <CheckCheck size={14} aria-hidden="true" />
        {t("resolveAll")}
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="inline-flex items-center gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") setArmed(false);
      }}
    >
      <input type="hidden" name="severity" value={severity ?? "all"} />
      {/* Plain submit button (not <SubmitButton>) — the confirm needs a
          ref for the armed-focus handoff, which the shared wrapper
          doesn't forward. Pending state stays visible via the spinner. */}
      <button
        ref={confirmRef}
        type="submit"
        disabled={pending}
        className={bulkStripButtonClass}
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : (
          <CheckCheck size={14} aria-hidden="true" />
        )}
        {t("resolveAllConfirm", { count })}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={pending}
        className={bulkStripButtonClass}
      >
        {tc("cancel")}
      </button>
    </form>
  );
}
