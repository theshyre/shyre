"use client";

import { AlertCircle } from "lucide-react";

/**
 * Inline form-field error with the a11y wiring the upstream
 * `@theshyre/ui` primitive doesn't have:
 *
 *   - `id` so the input can `aria-describedby` it (announce the
 *     error message when focus enters the field).
 *   - `role="alert"` so screen readers interrupt with the message
 *     when it appears (validation rejection should be loud — the
 *     user just took an action they expected to succeed).
 *   - `aria-live="assertive"` paired with role=alert so the error
 *     is announced even if AT misses the role transition.
 *
 * Returns null when `error` is falsy so it's safe to always render
 * — same shape as the upstream component. The `id` is rendered
 * even when the message is null (no — null returns early; that's
 * fine because the input's `aria-describedby` should be set
 * conditionally on `error` being truthy at the call site).
 */
export function FieldError({
  error,
  id,
}: {
  error: string | undefined | null;
  id?: string;
}): React.JSX.Element | null {
  if (!error) return null;

  return (
    <p
      id={id}
      role="alert"
      aria-live="assertive"
      className="mt-1 flex items-center gap-1 text-caption text-error"
    >
      <AlertCircle size={12} className="shrink-0" />
      {error}
    </p>
  );
}
