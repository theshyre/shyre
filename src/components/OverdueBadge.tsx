import type React from "react";
import { CalendarClock } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";

/**
 * "Past projected end" pill for a still-live project. Three channels:
 * icon (CalendarClock) + text + amber `warning` color. Deliberately
 * `warning`, NOT `error` (red) — red is reserved for over-budget burn,
 * so schedule slip stays a distinct, quieter signal. The tooltip
 * carries the exact projected-end date; `label` + `tooltip` arrive
 * pre-translated so this works from a server or client boundary.
 */
export function OverdueBadge({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}): React.JSX.Element {
  return (
    <Tooltip label={tooltip}>
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-caption font-medium text-warning-text">
        <CalendarClock size={12} aria-hidden="true" />
        {label}
      </span>
    </Tooltip>
  );
}
