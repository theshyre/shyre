"use client";

import { CheckCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { resolveErrorGroupAction } from "./actions";

/**
 * Per-group "Mark resolved" — resolves every unresolved occurrence in
 * the duplicate-group (a single error is just a group of one).
 */
export function ResolveButton({
  errorIds,
}: {
  errorIds: string[];
}): React.JSX.Element {
  const t = useTranslations("admin.errorLog");
  const { pending, success, handleSubmit } = useFormAction({
    action: resolveErrorGroupAction,
  });

  if (success) {
    return (
      <span className="flex items-center gap-1.5 text-body text-success">
        <CheckCircle size={14} aria-hidden="true" />
        {t("resolvedConfirmation")}
      </span>
    );
  }

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="error_ids" value={errorIds.join(",")} />
      <SubmitButton
        label={t("markResolved", { count: errorIds.length })}
        pending={pending}
        icon={CheckCircle}
        className={buttonSecondaryClass}
      />
    </form>
  );
}
