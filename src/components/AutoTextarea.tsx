"use client";

import {
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum rows reserved before the field grows. */
  minRows?: number;
}

/**
 * A controlled `<textarea>` that grows to fit its content instead of scrolling
 * inside a fixed box. The height is recomputed from `scrollHeight` whenever the
 * value changes (and on mount, so an edit form opens at the right size).
 *
 * Pure CSS `field-sizing: content` isn't yet supported in Safari, so this uses
 * the standard measure-then-set approach. Promotion candidate for
 * `@theshyre/ui` — see docs/reference/promotion-candidates.md.
 */
export function AutoTextarea({
  minRows = 2,
  value,
  className,
  style,
  ...rest
}: Props): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first so shrinking (text deleted) is measured correctly, then
    // grow to the content height.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={className}
      // Auto-grow owns the height, so hide the scrollbar and the manual
      // resize grip — the field is always exactly as tall as its content.
      style={{ resize: "none", overflow: "hidden", ...style }}
      {...rest}
    />
  );
}
