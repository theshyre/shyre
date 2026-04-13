"use client";

import { Loader2, CheckCircle } from "lucide-react";
import { buttonPrimaryClass } from "@/lib/form-styles";
import type { ComponentType } from "react";

interface SubmitButtonProps {
  /** Button label */
  label: string;
  /** Whether the form is submitting */
  pending: boolean;
  /** Whether the last submission was successful */
  success?: boolean;
  /** Success message to show briefly */
  successMessage?: string;
  /** Icon to show (optional) */
  icon?: ComponentType<{ size?: number }>;
  /** Additional CSS classes */
  className?: string;
  /** Whether the button is disabled (beyond pending state) */
  disabled?: boolean;
}

/**
 * Submit button with loading spinner and success indicator.
 */
export function SubmitButton({
  label,
  pending,
  success,
  successMessage,
  icon: Icon,
  className,
  disabled,
}: SubmitButtonProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending || disabled}
        className={className ?? buttonPrimaryClass}
      >
        {pending ? (
          <Loader2 size={16} className="animate-spin" />
        ) : Icon ? (
          <Icon size={16} />
        ) : null}
        {pending ? "Saving..." : label}
      </button>
      {success && successMessage && (
        <span className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle size={14} />
          {successMessage}
        </span>
      )}
    </div>
  );
}
