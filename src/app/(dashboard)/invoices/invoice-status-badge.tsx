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
}

/** Two-channel status indicator (color + text + icon → three when
 *  the label renders) per CLAUDE.md "Redundant visual encoding —
 *  MANDATORY". The previous version used a `bg-current` dot which is
 *  the same hue as the text, so it added nothing. Now each status
 *  carries a Lucide glyph that's distinct in shape from every other
 *  status — `void` and `draft` no longer look identical to a colorblind
 *  reader. */
export function InvoiceStatusBadge({
  status,
  iconOnly = false,
}: Props): React.JSX.Element {
  const t = useTranslations("invoices.status");
  const meta = STATUS_META[status] ?? STATUS_META.draft!;
  const Icon = meta.icon;
  // The i18n keys (`invoices.status.draft|sent|paid|void|overdue`)
  // match the status values exactly. Cast for next-intl's strict
  // key type — invalid statuses fall through to "draft" via the
  // STATUS_META lookup above so the cast is safe in practice.
  const label = t(status);

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

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${meta.classes}`}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

interface StatusMeta {
  icon: LucideIcon;
  classes: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  draft: {
    icon: FileEdit,
    classes: "bg-surface-inset text-content-muted",
  },
  sent: {
    icon: Send,
    classes: "bg-info-soft text-info",
  },
  paid: {
    icon: CheckCircle2,
    classes: "bg-success-soft text-success",
  },
  overdue: {
    icon: AlertTriangle,
    classes: "bg-error-soft text-error",
  },
  void: {
    icon: Ban,
    // void looks distinct from draft (Ban vs FileEdit) AND has a
    // muted border accent so colorblind users see two channels of
    // difference, not just an icon swap.
    classes:
      "bg-surface-inset text-content-muted ring-1 ring-inset ring-edge-muted",
  },
};
