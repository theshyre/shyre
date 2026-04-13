"use client";

import { useCallback, useState, useTransition } from "react";
import type { ZodSchema, ZodError } from "zod";

export interface FormActionState {
  /** Whether the form is currently submitting */
  pending: boolean;
  /** Whether the last submission was successful */
  success: boolean;
  /** Server error message (non-field-specific) */
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
  /** Server action to call */
  action: (formData: FormData) => Promise<void>;
  /** Transform FormData to the schema shape for validation */
  transform?: (formData: FormData) => unknown;
  /** Called after successful submission */
  onSuccess?: () => void;
  /** Auto-clear success message after ms (default: 3000) */
  successTimeout?: number;
}

/**
 * Hook for form actions with validation, pending states, and error handling.
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
          await action(formData);
          setSuccess(true);
          onSuccess?.();
          if (successTimeout > 0) {
            setTimeout(() => setSuccess(false), successTimeout);
          }
        } catch (err) {
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
