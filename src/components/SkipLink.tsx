/**
 * Skip-to-content link.
 *
 * Visually hidden until it receives keyboard focus, at which point it
 * becomes a visible button at the top-left. The first focusable element
 * on the page so a Tab keypress on page load lands here, ahead of the
 * sidebar's ~15 nav items + a now-mounted breadcrumb. Activating it
 * jumps focus to the main content area, which carries `tabIndex={-1}`
 * and `id={targetId}` so the focus actually moves.
 *
 * The pattern here is the standard "visually-hidden but exposed on
 * focus" — it does NOT use `display: none`/`hidden`, which would
 * remove the element from the focus order entirely.
 */
export function SkipLink({
  targetId,
  label = "Skip to main content",
}: {
  targetId: string;
  label?: string;
}): React.JSX.Element {
  return (
    <a
      href={`#${targetId}`}
      className={[
        // Default: clip to a 1px box outside the viewport
        "sr-only",
        // On focus: surface as a real, visible button at the top-left
        "focus:not-sr-only",
        "focus:fixed focus:left-[12px] focus:top-[12px] focus:z-50",
        "focus:rounded-md focus:border focus:border-edge focus:bg-surface-raised",
        "focus:px-[12px] focus:py-[8px]",
        "focus:text-body focus:font-medium focus:text-content",
        "focus:shadow-lg",
        "focus:outline-none focus:ring-2 focus:ring-focus-ring",
      ].join(" ")}
    >
      {label}
    </a>
  );
}
