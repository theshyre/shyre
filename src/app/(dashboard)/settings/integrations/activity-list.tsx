"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, ShieldAlert, XCircle, Activity } from "lucide-react";
import { LocalDateTime } from "@theshyre/ui";
import { EntryAuthor } from "@/components/EntryAuthor";
import type {
  IntegrationEventRow,
  TokenOwnerProfile,
} from "./token-constants";

interface Props {
  events: IntegrationEventRow[];
  profiles: TokenOwnerProfile[];
}

const STATUS_STYLE: Record<
  IntegrationEventRow["status"],
  { classes: string; icon: typeof CheckCircle2 }
> = {
  ok: { classes: "bg-success-soft text-success-text", icon: CheckCircle2 },
  denied: { classes: "bg-warning-soft text-warning-text", icon: ShieldAlert },
  error: { classes: "bg-error-soft text-error-text", icon: XCircle },
};

/**
 * Read-only tail of `integration_events` — the append-only audit log
 * every API call writes to (successes AND refusals). RLS scopes what
 * the viewer sees: own events, or the whole team's for owner/admin.
 *
 * Status uses icon + word + color (redundant encoding); timestamps
 * render in the viewer's timezone via LocalDateTime; the acting user
 * is always shown (authorship rule for user-attributed rows).
 */
export function ActivityList({ events, profiles }: Props): React.JSX.Element {
  const t = useTranslations("integrations.activity");
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity size={16} className="text-accent" aria-hidden="true" />
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("heading")}
        </h2>
      </div>
      <p className="text-caption text-content-muted">{t("description")}</p>

      {events.length === 0 ? (
        <p className="text-body text-content-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-edge">
          {events.map((event) => {
            const { classes, icon: StatusIcon } = STATUS_STYLE[event.status];
            return (
              <li
                key={event.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
              >
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${classes}`}
                >
                  <StatusIcon size={12} aria-hidden="true" />
                  {t(`status.${event.status}`)}
                </span>
                <code className="font-mono text-caption text-content-secondary">
                  {event.action}
                </code>
                <EntryAuthor
                  author={
                    profileById.get(event.user_id) ?? {
                      user_id: event.user_id,
                      display_name: null,
                      avatar_url: null,
                    }
                  }
                  compact
                />
                <span className="ml-auto text-caption text-content-muted">
                  <LocalDateTime value={event.occurred_at} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
