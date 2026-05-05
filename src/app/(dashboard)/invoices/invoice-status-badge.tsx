import { useTranslations } from "next-intl";
import {
  FileEdit,
  Send,
  CheckCircle2,
  AlertTriangle,
  Ban,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";

interface Props {
  status: string;
  /** When true, render only the icon — caller wants compact (e.g. table
   *  cell with limited width). Accessible name is set via aria-label. */
  iconOnly?: boolean;
  /** Visual size:
   *  - "default": small pill (text-caption + 12px icon) — used in
   *    list rows, kebab metadata, the entry chip.
   *  - "prominent": header chip (text-body-lg + 16px icon, larger
   *    padding) — used on the invoice detail header so the user
   *    can't miss "this is void". UX persona review picked the
   *    larger size for terminal states (paid / void / overdue);
   *    smaller pill remains correct for table contexts. */
  size?: "default" | "prominent";
}

/** Three-channel status indicator (icon + text + color, plus
 *  strikethrough on terminal "dead" states like void) per CLAUDE.md
 *  "Redundant visual encoding — MANDATORY".
 *
 *  Void uses `warning` tokens — the amber/orange hue is
 *  distinguishable from overdue's red (so we don't collide the two
 *  red-pill states), from draft's gray, and from sent/paid. Combined
 *  with `line-through` on the label (strikethrough is the cultural
 *  "canceled" signal), void is unambiguous even when icons don't
 *  render (plain-text email of the page, RSS export). */
export function InvoiceStatusBadge({
  status,
  iconOnly = false,
  size = "default",
}: Props): React.JSX.Element {
  const t = useTranslations("invoices.status");
  const tDescribe = useTranslations("invoices.statusDescription");
  const meta = STATUS_META[status] ?? STATUS_META.draft!;
  const Icon = meta.icon;
  // The i18n keys (`invoices.status.draft|sent|paid|void|overdue`)
  // match the status values exactly. Cast for next-intl's strict
  // key type — invalid statuses fall through to "draft" via the
  // STATUS_META lookup above so the cast is safe in practice.
  const label = t(status);
  // Long-form consequence ("This invoice has been voided and cannot
  // be collected") for screen-reader users on the prominent variant.
  // Per accessibility review, only terminal / actionable states need
  // the longer description — sent/paid/draft are self-explanatory
  // from the label alone.
  const longDescription =
    status === "void" || status === "overdue"
      ? tDescribe(status)
      : null;

  if (iconOnly) {
    return (
      <Tooltip label={label}>
        <span
          aria-label={label}
          className={`inline-flex items-center justify-center rounded-full p-1 ${meta.classes}`}
        >
          <Icon size={12} aria-hidden="true" />
        </span>
      </Tooltip>
    );
  }

  const sizingClasses =
    size === "prominent"
      ? "px-3 py-1 text-body-lg"
      : "px-2.5 py-0.5 text-caption";
  const iconSize = size === "prominent" ? 16 : 12;
  const labelClasses = meta.strikeLabel ? "line-through" : "";

  return (
    <span
      role={size === "prominent" ? "status" : undefined}
      aria-describedby={
        size === "prominent" && longDescription
          ? `${status}-status-desc`
          : undefined
      }
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizingClasses} ${meta.classes}`}
    >
      <Icon size={iconSize} aria-hidden="true" />
      <span className={labelClasses}>{label}</span>
      {size === "prominent" && longDescription && (
        <span id={`${status}-status-desc`} className="sr-only">
          {longDescription}
        </span>
      )}
    </span>
  );
}

interface StatusMeta {
  icon: LucideIcon;
  classes: string;
  /** When true, render the label with line-through. Used for
   *  void — the cultural "canceled" treatment, distinguishable
   *  from draft even at small sizes. */
  strikeLabel?: boolean;
}

const STATUS_META: Record<string, StatusMeta> = {
  draft: {
    icon: FileEdit,
    classes: "bg-surface-inset text-content-muted",
  },
  sent: {
    icon: Send,
    classes: "bg-info-soft text-info-text",
  },
  paid: {
    icon: CheckCircle2,
    classes: "bg-success-soft text-success-text",
  },
  overdue: {
    icon: AlertTriangle,
    classes: "bg-error-soft text-error-text",
  },
  void: {
    // Warning tokens (amber) — distinguishable at a glance from
    // draft (gray), sent (blue), paid (green), overdue (red). Per
    // UX review: void is "non-collectible / inert," not "error";
    // amber maps to that without screaming red.
    icon: Ban,
    classes: "bg-warning-soft text-warning-text",
    strikeLabel: true,
  },
};
