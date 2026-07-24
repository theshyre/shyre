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
  PenLine,
  PackageCheck,
  type LucideIcon,
} from "lucide-react";
import type { SignoffProgress } from "@/lib/proposals/list-view";

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
  /** Read-time "partially signed" projection (via
   *  `partialSignoffProgress`) for a multi-signer proposal with some —
   *  but not all — signatures in. Renders "N of M signed" instead of
   *  the bare Sent/Viewed, and takes precedence over `expired`: a deal
   *  actively being signed is more actionable news than a lapsed date.
   *  Ignored unless the projection was computed for an in-flight
   *  status, so it can never mislabel a decided proposal. */
  signoff?: SignoffProgress | null;
  /** Read-time "delivered" projection: a `converted` proposal whose
   *  engagement has been marked delivered (`delivered_at` is stamped).
   *  Renders "Delivered" (success tone) instead of the bare "Converted",
   *  the same read-time-projection idiom as `expired` / `signoff`. Ignored
   *  for any non-`converted` status, so a stale flag can never mislabel. */
  delivered?: boolean;
}

/** Three-channel proposal status indicator (icon + text + color) per the
 *  redundant-visual-encoding rule. Superseded gets the line-through
 *  "no longer in force" treatment, same cultural signal as void invoices. */
export function ProposalStatusBadge({
  status,
  size = "default",
  expired = false,
  signoff = null,
  delivered = false,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.status");
  const inFlight = status === "sent" || status === "viewed";
  // Partial sign-off wins over expiry: "1 of 2 signed" is the more
  // useful thing to know about an in-flight multi-signer deal.
  const showPartial = signoff != null && inFlight;
  const showExpired = !showPartial && expired && inFlight;
  // "Delivered" is a projection on the `converted` status (delivery is a
  // delivered_at stamp, not a status), so it never collides with the
  // in-flight projections above.
  const showDelivered = delivered && status === "converted";
  const meta = showPartial
    ? PARTIAL_META
    : showExpired
      ? EXPIRED_META
      : showDelivered
        ? DELIVERED_META
        : (STATUS_META[status] ?? STATUS_META.draft!);
  const Icon = meta.icon;
  const label = showPartial
    ? t("partiallySigned", { signed: signoff.signed, total: signoff.total })
    : showExpired
      ? t("expired")
      : showDelivered
        ? t("delivered")
        : t(status);

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

/** In-progress signing — accent tone (active, distinct from the info
 *  tone of a bare sent/viewed) with a pen icon. Reads as "being signed
 *  right now", not "done" (success) or "lapsed" (warning). */
const PARTIAL_META: StatusMeta = {
  icon: PenLine,
  classes: "bg-accent-soft text-accent-text",
};

/** Delivered — success tone with a "delivered package" icon. Reads as
 *  "the work is done", distinct from converted's accent "work created"
 *  tone and from accepted's check (which is about the signature). */
const DELIVERED_META: StatusMeta = {
  icon: PackageCheck,
  classes: "bg-success-soft text-success-text",
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
