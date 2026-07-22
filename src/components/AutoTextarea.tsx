"use client";

import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum rows reserved before the field grows. */
  minRows?: number;
}

/**
 * A `<textarea>` that grows to fit its content instead of scrolling inside a
 * fixed box. Works both controlled (`value`) and uncontrolled (`defaultValue`):
 * the height is recomputed from `scrollHeight` on mount, whenever `value`
 * changes (controlled), and on every `input` event (uncontrolled typing).
 *
 * Forwards its ref to the underlying textarea so callers can focus it (the
 * inline time-entry edit form autofocuses the description on open).
 *
 * Pure CSS `field-sizing: content` isn't yet supported in Safari, so this uses
 * the standard measure-then-set approach. Promotion candidate for
 * `@theshyre/ui` — see docs/reference/promotion-candidates.md.
 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function AutoTextarea(
    { minRows = 2, value, className, style, onInput, ...rest },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLTextAreaElement>(null);

    const setRefs = (el: HTMLTextAreaElement | null): void => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    const resize = (): void => {
      const el = innerRef.current;
      if (!el) return;
      // Collapse first so shrinking (text deleted) is measured correctly, then
      // grow to the content height.
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };

    // Runs on mount (sizing an uncontrolled defaultValue correctly) and, for
    // controlled use, whenever the value changes.
    useLayoutEffect(() => {
      resize();
    }, [value]);

    return (
      <textarea
        ref={setRefs}
        rows={minRows}
        value={value}
        // Uncontrolled fields (value === undefined) don't re-render on type,
        // so grow on the raw input event instead.
        onInput={(e) => {
          resize();
          onInput?.(e);
        }}
        className={className}
        // Auto-grow owns the height, so hide the scrollbar and the manual
        // resize grip — the field is always exactly as tall as its content.
        style={{ resize: "none", overflow: "hidden", ...style }}
        {...rest}
      />
    );
  },
);
