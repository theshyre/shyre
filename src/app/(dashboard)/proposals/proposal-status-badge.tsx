import { useTranslations } from "next-intl";
import {
  Clock,
  FileEdit,
  Send,
  Eye,
  CheckCircle2,
  XCircle,
  FolderCheck,
  History,
  type LucideIcon,
} from "lucide-react";

interface Props {
  status: string;
  /** "default" = list-row pill; "prominent" = detail-header chip
   *  (larger type + icon), mirroring InvoiceStatusBadge's sizing. */
  size?: "default" | "prominent";
  /** Read-time expiry cue (computed by the caller via
   *  `isProposalExpired` — the DB status is untouched). When true on
   *  an in-flight (sent/viewed) proposal, the badge renders as
   *  "Expired" with a clock icon + warning tone instead of
   *  Sent/Viewed. Ignored for any other status so a stale flag can
   *  never mislabel a decided proposal. */
  expired?: boolean;
}

/** Three-channel proposal status indicator (icon + text + color) per the
 *  redundant-visual-encoding rule. Superseded gets the line-through
 *  "no longer in force" treatment, same cultural signal as void invoices. */
export function ProposalStatusBadge({
  status,
  size = "default",
  expired = false,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.status");
  const showExpired =
    expired && (status === "sent" || status === "viewed");
  const meta = showExpired
    ? EXPIRED_META
    : (STATUS_META[status] ?? STATUS_META.draft!);
  const Icon = meta.icon;
  const label = showExpired ? t("expired") : t(status);

  const sizingClasses =
    size === "prominent"
      ? "px-3 py-1 text-body-lg"
      : "px-2.5 py-0.5 text-caption";
  const iconSize = size === "prominent" ? 16 : 12;

  return (
    <span
      role={size === "prominent" ? "status" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizingClasses} ${meta.classes}`}
    >
      <Icon size={iconSize} aria-hidden="true" />
      <span className={meta.strikeLabel ? "line-through" : ""}>{label}</span>
    </span>
  );
}

interface StatusMeta {
  icon: LucideIcon;
  classes: string;
  strikeLabel?: boolean;
}

/** Read-time "offer lapsed" cue — warning tone (attention, not
 *  failure) so it reads distinctly from declined's error tone. */
const EXPIRED_META: StatusMeta = {
  icon: Clock,
  classes: "bg-warning-soft text-warning-text",
};

const STATUS_META: Record<string, StatusMeta> = {
  draft: { icon: FileEdit, classes: "bg-surface-inset text-content-muted" },
  sent: { icon: Send, classes: "bg-info-soft text-info-text" },
  // Same color family as sent — "in flight" — differentiated by icon + text
  // (two of the three mandatory channels), like the sent→viewed continuum.
  viewed: { icon: Eye, classes: "bg-info-soft text-info-text" },
  accepted: { icon: CheckCircle2, classes: "bg-success-soft text-success-text" },
  declined: { icon: XCircle, classes: "bg-error-soft text-error-text" },
  converted: { icon: FolderCheck, classes: "bg-accent-soft text-accent" },
  superseded: {
    icon: History,
    classes: "bg-warning-soft text-warning-text",
    strikeLabel: true,
  },
};
