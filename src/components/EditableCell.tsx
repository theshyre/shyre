"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";

export type EditableCellVariant =
  | "text"
  | "number"
  | "date"
  | "select"
  | "textarea";

export interface EditableCellSelectOption {
  value: string;
  label: string;
}

interface CommonProps {
  /** The value as it lives in the database, in canonical form
   *  (date as YYYY-MM-DD, number as decimal string, etc.). The
   *  input renders this verbatim while editing. */
  value: string;
  /** Optional custom render for the display state — lets the
   *  caller show "Dec 16, 2019" while the editable value is
   *  "2019-12-16". When omitted, falls back to `value` or a
   *  placeholder dash. */
  displayNode?: ReactNode;
  /** Visible placeholder shown in idle state when value is empty,
   *  and inside the input when editing. */
  placeholder?: string;
  /** Required accessible label — the cell has no visible label
   *  of its own (column header lives in the thead, not adjacent). */
  ariaLabel: string;
  /** Commit handler. Called with the new value when the user
   *  presses Enter, blurs the input, or tabs away. The Promise's
   *  rejection drives the cell's error state. */
  onCommit: (newValue: string) => Promise<void>;
  /** Optional client-side validator. Return a string to reject
   *  with that message; return null/undefined to accept. */
  validate?: (newValue: string) => string | null | undefined;
  /** When true, the cell isn't clickable (e.g., row's incurred_on
   *  is inside a locked period — the action would 403 anyway). */
  disabled?: boolean;
  /** Optional reason shown via tooltip when disabled. */
  disabledReason?: string;
  /** Extra className applied to the outer cell wrapper. */
  className?: string;
}

interface TextProps extends CommonProps {
  variant: "text";
}

interface NumberProps extends CommonProps {
  variant: "number";
  /** Optional `min`, `step` for the underlying <input type="number">. */
  min?: number;
  step?: number;
}

interface DateProps extends CommonProps {
  variant: "date";
}

interface SelectProps extends CommonProps {
  variant: "select";
  options: EditableCellSelectOption[];
}

interface TextareaProps extends CommonProps {
  variant: "textarea";
  /** Number of rows in the editing textarea. Default 2. */
  rows?: number;
}

export type EditableCellProps =
  | TextProps
  | NumberProps
  | DateProps
  | SelectProps
  | TextareaProps;

type Mode = "idle" | "editing" | "saving" | "error";

/**
 * Single-cell editable widget for spreadsheet-feel data tables.
 *
 *  - Click (or Enter when focused) → switches to editing.
 *  - Enter (or blur, or Tab) → commits.
 *      Textarea variant uses Cmd/Ctrl+Enter so plain Enter inserts
 *      a newline without saving.
 *  - Escape → reverts to the original value, no commit.
 *  - Save spinner overlays during the awaiting promise; if the
 *    promise rejects, the cell goes into an error state with a
 *    red border + the rejection message via Tooltip until the
 *    user clicks back in to retry.
 *
 * The widget never knows about Supabase or actions — it just calls
 * `onCommit(newValue)` and watches whether the promise resolves.
 * That keeps it unit-testable and reusable beyond expenses.
 */
export function EditableCell(props: EditableCellProps): React.JSX.Element {
  const { value, displayNode, placeholder, ariaLabel, onCommit, disabled } =
    props;

  const [mode, setMode] = useState<Mode>("idle");
  // Draft is null while idle — derived from `value` at render time
  // so external value changes (parent re-fetched, sibling save
  // updated the row) flow through without a syncing useEffect.
  // When the user starts editing we copy `value` into `draft`; from
  // there typing mutates `draft` until commit/cancel resets to null.
  const [draft, setDraft] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const effectiveDraft = draft ?? value;

  // Focus the input when entering edit mode. select() puts the
  // cursor at the end + selects all so typing replaces wholesale.
  const inputRef = useRef<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
  >(null);
  useEffect(() => {
    if (mode === "editing") {
      const el = inputRef.current;
      if (el) {
        el.focus();
        if ("select" in el && typeof el.select === "function") {
          el.select();
        }
      }
    }
  }, [mode]);

  const startEdit = useCallback(() => {
    if (disabled) return;
    if (mode === "saving") return;
    setMode("editing");
    setDraft(value);
    setErrorMessage(null);
  }, [disabled, mode, value]);

  const cancelEdit = useCallback(() => {
    setMode("idle");
    setDraft(null);
    setErrorMessage(null);
  }, []);

  const commit = useCallback(async () => {
    const next = draft ?? value;
    // No change → just snap back to idle, no server roundtrip.
    if (next === value) {
      setMode("idle");
      setDraft(null);
      setErrorMessage(null);
      return;
    }
    if (props.validate) {
      const err = props.validate(next);
      if (err) {
        setErrorMessage(err);
        setMode("error");
        return;
      }
    }
    setMode("saving");
    setErrorMessage(null);
    try {
      await onCommit(next);
      setMode("idle");
      setDraft(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Save failed");
      setMode("error");
    }
  }, [draft, value, onCommit, props]);

  const handleKey = useCallback(
    (
      e: KeyboardEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
        return;
      }
      if (e.key === "Enter") {
        if (props.variant === "textarea" && !(e.metaKey || e.ctrlKey)) {
          // Plain Enter in textarea inserts a newline — let the
          // browser handle it. Cmd/Ctrl+Enter commits.
          return;
        }
        e.preventDefault();
        void commit();
      }
      // Tab falls through — onBlur fires next, which commits.
    },
    [cancelEdit, commit, props.variant],
  );

  // ── Idle / display rendering ────────────────────────────────
  if (mode !== "editing" && mode !== "saving" && mode !== "error") {
    return renderDisplay({
      ariaLabel,
      placeholder,
      value,
      displayNode,
      disabled: disabled ?? false,
      disabledReason: props.disabledReason,
      onActivate: startEdit,
      className: props.className,
    });
  }

  // ── Saving overlay ──────────────────────────────────────────
  // While awaiting the promise we keep the input visible (so the
  // user can see what they typed) but disabled, with a spinner
  // pinned to the corner. No idle revert until the promise
  // settles — even on a slow save, the displayed value is what
  // the user typed, not the stale one.
  const showSpinner = mode === "saving";
  const errorBorder = mode === "error";

  // ── Editing / saving / error: input rendering ────────────────
  // min-w-0 + max-w-full are the load-bearing flexbox/grid escape
  // hatches: native <select> and <input> default to min-content
  // sizing under flex/grid descendants, which can blow past a
  // table-fixed column width when the value (or longest <option>
  // label) is wider than the column. Clamp explicitly so the
  // edit input always respects its <td>'s width.
  return (
    <div
      className={`relative block min-w-0 max-w-full ${props.className ?? ""}`}
    >
      {props.variant === "select" ? (
        <select
          ref={(el) => {
            inputRef.current = el;
          }}
          aria-label={ariaLabel}
          value={effectiveDraft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => void commit()}
          disabled={showSpinner}
          className={`block w-full min-w-0 max-w-full rounded-sm border bg-surface px-1.5 py-0.5 text-inherit ${
            errorBorder ? "border-error" : "border-accent"
          } focus:outline-none focus:ring-1 focus:ring-accent`}
        >
          {(props as SelectProps).options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : props.variant === "textarea" ? (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          aria-label={ariaLabel}
          value={effectiveDraft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => void commit()}
          disabled={showSpinner}
          rows={(props as TextareaProps).rows ?? 2}
          placeholder={placeholder}
          className={`block w-full min-w-0 max-w-full rounded-sm border bg-surface px-1.5 py-0.5 text-inherit resize-none ${
            errorBorder ? "border-error" : "border-accent"
          } focus:outline-none focus:ring-1 focus:ring-accent`}
        />
      ) : (
        <input
          ref={(el) => {
            inputRef.current = el;
          }}
          aria-label={ariaLabel}
          type={
            props.variant === "number"
              ? "number"
              : props.variant === "date"
                ? "date"
                : "text"
          }
          value={effectiveDraft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => void commit()}
          disabled={showSpinner}
          placeholder={placeholder}
          {...(props.variant === "number" && {
            min: (props as NumberProps).min,
            step: (props as NumberProps).step,
          })}
          className={`block w-full min-w-0 max-w-full rounded-sm border bg-surface px-1.5 py-0.5 text-inherit ${
            errorBorder ? "border-error" : "border-accent"
          } focus:outline-none focus:ring-1 focus:ring-accent`}
        />
      )}

      {showSpinner && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-1 flex items-center"
        >
          <Loader2 size={12} className="animate-spin text-content-muted" />
        </div>
      )}
      {errorBorder && errorMessage && (
        <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center">
          <Tooltip label={errorMessage} labelMode="label">
            <span className="inline-flex">
              <AlertTriangle size={12} className="text-error" />
            </span>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

function renderDisplay({
  ariaLabel,
  placeholder,
  value,
  displayNode,
  disabled,
  disabledReason,
  onActivate,
  className,
}: {
  ariaLabel: string;
  placeholder: string | undefined;
  value: string;
  displayNode: ReactNode;
  disabled: boolean;
  disabledReason: string | undefined;
  onActivate: () => void;
  className: string | undefined;
}): React.JSX.Element {
  const empty = !value || value.trim() === "";
  const content =
    displayNode !== undefined
      ? displayNode
      : empty
        ? (placeholder ?? "—")
        : value;

  if (disabled) {
    const inner = (
      <span
        className={`inline-block w-full cursor-not-allowed text-content-muted ${className ?? ""}`}
        aria-disabled
      >
        {content}
      </span>
    );
    return disabledReason ? (
      <Tooltip label={disabledReason} labelMode="label">
        {inner}
      </Tooltip>
    ) : (
      inner
    );
  }

  // Footprint matches the edit input on purpose: 1px transparent
  // border + identical px-1.5 py-0.5 padding + min-w-0 max-w-full
  // clamp. Toggling display→edit becomes a pure content swap, no
  // border thickness change, no padding shift, no width nudge —
  // just the input replacing the button at the same coords. Per
  // ux-designer review: "Consistency over cleverness" + the
  // table-fixed colgroup owns column width above.
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onActivate}
      onFocus={() => {
        // No auto-edit on focus — focus alone shouldn't switch
        // mode (would clobber keyboard navigation through a
        // table). Activation requires Enter/Space (button
        // default) or click.
      }}
      className={`block w-full min-w-0 max-w-full text-left rounded-sm border border-transparent px-1.5 py-0.5 hover:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
        empty ? "text-content-muted" : "text-content"
      } ${className ?? ""}`}
    >
      {content}
    </button>
  );
}
