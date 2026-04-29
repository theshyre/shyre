"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { ZodSchema } from "zod";
import type { SerializedAppError } from "@/lib/errors";

/** Result type returned by safeAction-wrapped server actions */
type ActionResult =
  | { success: true }
  | { success: false; error: SerializedAppError };

export interface FormActionState {
  /** Whether the form is currently submitting */
  pending: boolean;
  /** Whether the last submission was successful */
  success: boolean;
  /** Server error i18n key or message (non-field-specific) */
  serverError: string | null;
  /** Field-level validation errors */
  fieldErrors: Record<string, string>;
  /** Submit handler to pass to form action */
  handleSubmit: (formData: FormData) => Promise<void>;
  /** Reset the form state */
  reset: () => void;
}

interface UseFormActionOptions<T> {
  /** Zod schema for client-side validation */
  schema?: ZodSchema<T>;
  /** Server action to call — can return ActionResult (safeAction) or void (legacy) */
  action: (formData: FormData) => Promise<ActionResult | void>;
  /** Transform FormData to the schema shape for validation */
  transform?: (formData: FormData) => unknown;
  /** Called after successful submission */
  onSuccess?: () => void;
  /** Auto-clear success message after ms (default: 3000) */
  successTimeout?: number;
}

/**
 * Hook for form actions with validation, pending states, and error handling.
 * Understands both safeAction (returns ActionResult) and legacy (void/throws) patterns.
 */
export function useFormAction<T = unknown>({
  schema,
  action,
  transform,
  onSuccess,
  successTimeout = 3000,
}: UseFormActionOptions<T>): FormActionState {
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Root-level translator so we can resolve dot-path keys like
  // "errors.authForbidden" that server actions return.
  const t = useTranslations();

  /**
   * Translate an i18n key (e.g. "errors.authForbidden") to a user-facing
   * message, falling back to the raw value if no translation exists.
   */
  const translateError = useCallback(
    (keyOrMessage: string): string => {
      try {
        const translated = t(keyOrMessage);
        // next-intl returns the key itself when not found — detect that and
        // fall through to the raw value so legacy thrown-Error messages
        // still render sensibly.
        if (translated && translated !== keyOrMessage) return translated;
      } catch {
        // Key not in dictionary — fall through.
      }
      return keyOrMessage;
    },
    [t],
  );

  const handleSubmit = useCallback(
    async (formData: FormData) => {
      setServerError(null);
      setFieldErrors({});
      setSuccess(false);

      // Client-side validation
      if (schema && transform) {
        const data = transform(formData);
        const result = schema.safeParse(data);
        if (!result.success) {
          const errors: Record<string, string> = {};
          for (const issue of result.error.issues) {
            const path = issue.path.join(".");
            if (path && !errors[path]) {
              errors[path] = issue.message;
            }
          }
          setFieldErrors(errors);
          return;
        }
      }

      // Server submission
      startTransition(async () => {
        try {
          const result = await action(formData);

          // Handle safeAction ActionResult
          if (result && typeof result === "object" && "success" in result) {
            if (!result.success) {
              setServerError(translateError(result.error.userMessageKey));
              if (result.error.fieldErrors) {
                setFieldErrors(result.error.fieldErrors);
              }
              return;
            }
          }

          // Success
          setSuccess(true);
          onSuccess?.();
          if (successTimeout > 0) {
            setTimeout(() => setSuccess(false), successTimeout);
          }
        } catch (err) {
          // Next.js's redirect() / notFound() throw an internal
          // exception with a digest; React/Next.js handles those at
          // the framework level. Don't swallow them here — re-throw
          // so navigation actually happens. Without this, a redirect
          // from a server action surfaces as a fake "error" whose
          // message ("NEXT_REDIRECT") gets fed to translateError
          // and triggers a MISSING_MESSAGE crash.
          if (isNextInternalError(err)) {
            throw err;
          }
          // Legacy throws (for actions not yet wrapped with safeAction).
          // Still run through translateError in case the thrown message
          // happens to be an i18n key.
          const raw = err instanceof Error ? err.message : "An error occurred";
          setServerError(translateError(raw));
        }
      });
    },
    [schema, transform, action, onSuccess, successTimeout, translateError]
  );

  const reset = useCallback(() => {
    setSuccess(false);
    setServerError(null);
    setFieldErrors({});
  }, []);

  return {
    pending: isPending,
    success,
    serverError,
    fieldErrors,
    handleSubmit,
    reset,
  };
}

/**
 * Detect Next.js's internal redirect / notFound throws by their
 * digest. Mirrors the same predicate used in
 * `src/lib/safe-action.ts` for the server side. Kept inlined here
 * because that module is "use server" and can't be imported into
 * a client hook. Exported for testing.
 */
export function isNextInternalError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: string }).digest;
  if (typeof digest !== "string") return false;
  return (
    digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")
  );
}
