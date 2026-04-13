"use client";

import { AlertCircle } from "lucide-react";

/**
 * Inline field error display.
 * Shows below the field with error icon + message.
 */
export function FieldError({
  error,
}: {
  error: string | undefined;
}): React.JSX.Element | null {
  if (!error) return null;

  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-error">
      <AlertCircle size={12} className="shrink-0" />
      {error}
    </p>
  );
}
