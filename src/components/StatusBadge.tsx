import type React from "react";

/**
 * Project lifecycle status pill. Two channels: the text label always
 * carries the meaning; the soft color is redundant reinforcement (the
 * dot is `aria-hidden`). Extracted from projects-table so the list, the
 * project detail header, and any future surface share one color map —
 * add a status in exactly one place.
 *
 * `label` is passed pre-translated by the caller (server uses
 * getTranslations, client uses useTranslations) so this stays a plain
 * presentational component usable from either boundary.
 */
const STATUS_COLOR_CLASSES: Record<string, string> = {
  active: "bg-success-soft text-success-text",
  paused: "bg-warning-soft text-warning-text",
  completed: "bg-info-soft text-info-text",
  archived: "bg-surface-inset text-content-muted",
};

export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label: string;
}): React.JSX.Element {
  const classes =
    STATUS_COLOR_CLASSES[status] ?? "bg-surface-inset text-content-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
