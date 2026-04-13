"use client";

import { useCallback, useState, useTransition } from "react";
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
              setServerError(result.error.userMessageKey);
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
          // Legacy throws (for actions not yet wrapped with safeAction)
          setServerError(
            err instanceof Error ? err.message : "An error occurred"
          );
        }
      });
    },
    [schema, transform, action, onSuccess, successTimeout]
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
