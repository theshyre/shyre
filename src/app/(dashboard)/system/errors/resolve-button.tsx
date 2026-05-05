"use client";

import { CheckCircle } from "lucide-react";
import { useFormAction } from "@/hooks/use-form-action";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { resolveErrorAction } from "./actions";

export function ResolveButton({
  errorId,
}: {
  errorId: string;
}): React.JSX.Element {
  const { pending, success, handleSubmit } = useFormAction({
    action: resolveErrorAction,
  });

  if (success) {
    return (
      <span className="flex items-center gap-1.5 text-body-lg text-success">
        <CheckCircle size={14} />
        Resolved
      </span>
    );
  }

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="error_id" value={errorId} />
      <SubmitButton
        label="Mark Resolved"
        pending={pending}
        icon={CheckCircle}
        className={buttonSecondaryClass}
      />
    </form>
  );
}
