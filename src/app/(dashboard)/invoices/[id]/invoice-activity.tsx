import { getTranslations } from "next-intl/server";
import { Avatar, formatDateTime, resolveAvatarUrl } from "@theshyre/ui";
import {
  CheckCircle2,
  Send,
  XCircle,
  CircleDollarSign,
  Download,
  FilePlus2,
  Pencil,
} from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";
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
  paid: CheckCircle2,
  voided: XCircle,
  payment: CircleDollarSign,
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

  function titleFor(event: InvoiceActivityEvent): string {
    switch (event.type) {
      case "imported":
        return t("imported");
      case "created":
        return t("created");
      case "sent":
        return t("sent");
      case "paid":
        return t("paid");
      case "voided":
        return t("voided");
      case "payment":
        return t("paymentReceived", {
          date: formatDateTime(event.payment?.paidOn ?? event.occurredAt, "en-US")
            .split(",")
            .slice(0, 2)
            .join(",")
            .trim(),
        });
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
                  {actorName} {t("on")}{" "}
                  <time dateTime={event.occurredAt}>
                    {formatDateTime(event.occurredAt)}
                  </time>
                </p>
                {event.payment?.method || event.payment?.reference ? (
                  <p className="mt-1 text-caption text-content-secondary">
                    {[event.payment?.method, event.payment?.reference]
                      .filter((s): s is string => Boolean(s))
                      .join(" · ")}
                  </p>
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
