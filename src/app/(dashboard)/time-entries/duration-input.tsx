"use client";

import { useState, forwardRef, type KeyboardEvent } from "react";
import {
  formatDurationHMZero,
  parseDurationInput,
} from "@/lib/time/week";
import { inputClass } from "@/lib/form-styles";

interface Props {
  /** Input name — the hidden input carries the parsed minutes as string */
  name: string;
  defaultMinutes?: number | null;
  /** Called on every valid parse (incl. blur-normalized value) */
  onChange?: (minutes: number | null) => void;
  /** Called on blur with the final minutes (null if unparseable) */
  onCommit?: (minutes: number | null) => void;
  /** Placeholder shown when empty. Default is a muted `·` so empty cells recede. */
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Select all on focus (Harvest behavior) */
  selectOnFocus?: boolean;
  /** Commit on Enter (blurs the input) */
  commitOnEnter?: boolean;
  /** Fires on arrow keys so the parent can move focus between cells. */
  onArrowNav?: (direction: "up" | "down" | "left" | "right") => void;
}

/**
 * Input that accepts duration strings like "3:15", "3h 15m", "3.25", "3" and
 * normalizes to H:MM on blur. The underlying form value (the `name` prop) is
 * the parsed minutes as a string, via a hidden input.
 */
export const DurationInput = forwardRef<HTMLInputElement, Props>(
  function DurationInput(
    {
      name,
      defaultMinutes,
      onChange,
      onCommit,
      placeholder = "·",
      className,
      ariaLabel,
      autoFocus,
      selectOnFocus = true,
      commitOnEnter = true,
      onArrowNav,
    },
    ref,
  ): React.JSX.Element {
    const initial =
      defaultMinutes && defaultMinutes > 0
        ? formatDurationHMZero(defaultMinutes)
        : "";
    const [text, setText] = useState(initial);
    const [minutes, setMinutes] = useState<number | null>(defaultMinutes ?? 0);
    const [invalid, setInvalid] = useState(false);

    function handleChange(value: string): void {
      setText(value);
      const parsed = parseDurationInput(value);
      setInvalid(parsed === null);
      setMinutes(parsed);
      onChange?.(parsed);
    }

    function handleBlur(): void {
      const parsed = parseDurationInput(text);
      if (parsed === null) {
        // Leave as-is; caller can decide what to do
        onCommit?.(null);
        return;
      }
      setMinutes(parsed);
      setInvalid(false);
      setText(parsed > 0 ? formatDurationHMZero(parsed) : "");
      onCommit?.(parsed);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
      if (commitOnEnter && e.key === "Enter") {
        // Commit + move down one row, Excel-style. Blur writes through
        // onCommit; then we ask the parent to shift focus.
        e.preventDefault();
        e.currentTarget.blur();
        onArrowNav?.("down");
        return;
      }
      if (!onArrowNav) return;
      const el = e.currentTarget;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const atEnd =
        el.selectionStart === el.value.length &&
        el.selectionEnd === el.value.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onArrowNav("down");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        onArrowNav("up");
      } else if (e.key === "ArrowRight" && atEnd) {
        e.preventDefault();
        onArrowNav("right");
      } else if (e.key === "ArrowLeft" && atStart) {
        e.preventDefault();
        onArrowNav("left");
      }
    }

    const isEmpty = !text;
    return (
      <>
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          value={text}
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onFocus={selectOnFocus ? (e) => e.currentTarget.select() : undefined}
          className={`${className ?? inputClass} font-mono tabular-nums text-right font-medium ${
            isEmpty ? "text-content-muted/60 placeholder:text-content-muted/50" : "text-content"
          } ${invalid ? "border-error" : ""}`}
        />
        <input type="hidden" name={name} value={minutes ?? ""} />
      </>
    );
  },
);
