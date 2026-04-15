"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

interface Props {
  /** Pixel size of the spinner. Default 12. */
  size?: number;
  /** Extra classes — usually `ml-auto` to push the spinner to the right edge. */
  className?: string;
}

/**
 * Renders only when its enclosing `<Link>` is pending navigation.
 * Drop inside a `<Link>`'s children to give that specific link a
 * "yes, I heard you" indicator while the next route loads.
 *
 * Pairs with `<TopProgressBar>` — together they answer:
 *   - what's loading? (the spinner is on the link you clicked)
 *   - is something happening at all? (the bar at the top)
 */
export function LinkPendingSpinner({ size = 12, className = "ml-auto" }: Props): React.JSX.Element | null {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      size={size}
      className={`shrink-0 animate-spin text-content-muted ${className}`}
    />
  );
}
