import { getTranslations } from "next-intl/server";
import { Avatar, resolveAvatarUrl } from "@theshyre/ui";
import {
  CheckCircle2,
  Send,
  XCircle,
  CircleDollarSign,
  Download,
  FilePlus2,
  Pencil,
  MailCheck,
  MailWarning,
  ShieldAlert,
} from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";
import { LocalDateTime } from "@/components/LocalDateTime";
import { Tooltip } from "@/components/Tooltip";
import {
  buildInvoiceActivity,
  type InvoiceActivityEvent,
  type InvoiceActivityEventType,
  type InvoiceActivityInput,
} from "@/lib/invoice-activity";

interface ProfileLookup {
  displayName: string;
  avatarUrl: string | null;
}

interface InvoiceActivityProps {
  data: InvoiceActivityInput;
  profileById: Map<string, ProfileLookup>;
  unknownUserLabel: string;
}

/**
 * Format a YYYY-MM-DD or ISO timestamp as a calendar date string
 * (e.g. "Apr 15, 2026") for the "Payment received on <date>" headline.
 * Uses UTC component extraction so a date-only value doesn't shift
 * across the dateline depending on server / viewer TZ.
 */
function formatPaymentHeadlineDate(value: string): string {
  // Date-only fast path so "2026-04-15" doesn't get UTC-parsed and
  // flip to Apr 14 in negative offsets.
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${months[Number(m) - 1]} ${Number(d)}, ${y}`;
  }
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Each event type maps to a single icon. Color comes from the row
// itself, not the icon, to keep redundant visual encoding modest:
// every row already has icon + text, so we don't also paint hue.
const ICON_BY_TYPE: Record<
  InvoiceActivityEventType,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  imported: Download,
  created: FilePlus2,
  sent: Send,
  delivered: MailCheck,
  bounced: MailWarning,
  complained: ShieldAlert,
  paid: CheckCircle2,
  voided: XCircle,
  payment: CircleDollarSign,
  paidDateCorrection: Pencil,
  updated: Pencil,
};

export async function InvoiceActivity({
  data,
  profileById,
  unknownUserLabel,
}: InvoiceActivityProps): Promise<React.JSX.Element | null> {
  const events = buildInvoiceActivity(data);
  if (events.length === 0) return null;

  const t = await getTranslations("invoices.activity");

  function titleFor(event: InvoiceActivityEvent): React.ReactNode {
    switch (event.type) {
      case "imported":
        return t("imported");
      case "created":
        return t("created");
      case "sent":
        // When we know the recipient (Harvest imports + future
        // in-app send actions populate this), surface it the same
        // way Harvest's own log does: "Sent invoice to <name>
        // <email>". Falls back to the bare title when not known.
        if (event.sentTo) {
          const { name, email } = event.sentTo;
          return name
            ? `${t("sentToWithName", { name, email })}`
            : `${t("sentTo", { email })}`;
        }
        return t("sent");
      case "delivered":
        return t("delivered");
      case "bounced":
        return event.webhook?.detail
          ? t("bouncedWithDetail", { detail: event.webhook.detail })
          : t("bounced");
      case "complained":
        return t("complained");
      case "paid":
        return t("paid");
      case "voided":
        return t("voided");
      case "payment":
        // The "Payment received on <date>" headline uses the calendar
        // date (paid_on), which is the bookkeeper's grain — same
        // every day across timezones, no localization needed.
        return t("paymentReceived", {
          date: formatPaymentHeadlineDate(
            event.payment?.paidOn ?? event.occurredAt,
          ),
        });
      case "paidDateCorrection": {
        const c = event.paidDateCorrection;
        const oldD = c?.oldPaidAt
          ? formatPaymentHeadlineDate(c.oldPaidAt.slice(0, 10))
          : t("unknownDate");
        const newD = c?.newPaidAt
          ? formatPaymentHeadlineDate(c.newPaidAt.slice(0, 10))
          : t("unknownDate");
        return t("paidDateCorrection", { oldDate: oldD, newDate: newD });
      }
      case "updated":
        return t("updated");
    }
  }

  return (
    <section
      aria-labelledby="invoice-activity-heading"
      className="mt-8 rounded-lg border border-edge bg-surface-raised"
    >
      <h2
        id="invoice-activity-heading"
        className="border-b border-edge px-4 py-3 text-body-lg font-semibold text-content"
      >
        {t("title")}
      </h2>
      <ol className="divide-y divide-edge">
        {events.map((event) => {
          const Icon = ICON_BY_TYPE[event.type];
          const profile = event.actorUserId
            ? profileById.get(event.actorUserId)
            : null;
          const actorName = profile?.displayName ?? unknownUserLabel;
          return (
            <li
              key={event.id}
              className="flex items-start gap-3 px-4 py-3"
            >
              <div className="shrink-0 pt-0.5">
                {profile ? (
                  <Avatar
                    avatarUrl={resolveAvatarUrl(
                      profile.avatarUrl,
                      event.actorUserId ?? "",
                    )}
                    displayName={profile.displayName}
                    size={28}
                  />
                ) : (
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-inset text-content-muted"
                    aria-hidden="true"
                  >
                    <Icon size={14} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-body text-content">
                  <Icon
                    size={14}
                    className="text-content-muted shrink-0"
                    aria-hidden="true"
                  />
                  <span className="font-semibold">{titleFor(event)}</span>
                </div>
                <p className="mt-0.5 text-caption text-content-muted">
                  {/* Webhook-emitted events have no human actor —
                      Resend wrote them. Show "via Resend" instead
                      of "Unknown user." Same shape, less confusing. */}
                  {event.type === "delivered" ||
                  event.type === "bounced" ||
                  event.type === "complained"
                    ? t("viaResend")
                    : actorName}{" "}
                  {t("on")} <LocalDateTime value={event.occurredAt} />
                </p>
                {event.payment?.method || event.payment?.reference ? (
                  <p className="mt-1 text-caption text-content-secondary">
                    {[event.payment?.method, event.payment?.reference]
                      .filter((s): s is string => Boolean(s))
                      .join(" · ")}
                  </p>
                ) : null}
                {event.type === "paidDateCorrection" &&
                event.paidDateCorrection?.reason ? (
                  <p className="mt-1 text-caption text-content-secondary italic">
                    “{event.paidDateCorrection.reason}”
                  </p>
                ) : null}
                {event.type === "sent" && event.sentTo?.attachmentSha256 ? (
                  <Tooltip label={event.sentTo.attachmentSha256}>
                    <p className="mt-1 text-caption text-content-muted font-mono">
                      {t("pdfSha", {
                        sha: event.sentTo.attachmentSha256.slice(0, 12),
                      })}
                    </p>
                  </Tooltip>
                ) : null}
              </div>
              {event.type === "payment" && event.payment ? (
                <div className="shrink-0 text-right font-mono tabular-nums text-body font-semibold text-success">
                  {formatCurrency(event.payment.amount, event.payment.currency)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
