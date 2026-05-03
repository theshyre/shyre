import { Check, AlertCircle, Clock, ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

interface ChecklistItem {
  id: string;
  status: "ok" | "todo" | "blocked";
  title: string;
  detail: string;
  /** Optional anchor / external link the user follows to fix the
   *  step. Internal anchors render with a `#` href; external links
   *  open in a new tab with `rel=noopener`. */
  action?: { href: string; label: string; external?: boolean };
}

interface Props {
  /** Set when EMAIL_KEY_ENCRYPTION_KEY is present in the running
   *  process env. Detected server-side at request time. */
  encryptionKeyConfigured: boolean;
  /** Set when RESEND_WEBHOOK_SECRET is present. */
  webhookSecretConfigured: boolean;
  /** Set when team_email_config has an api_key_encrypted row for
   *  this team. */
  apiKeySaved: boolean;
  /** Set when team_email_config has a non-empty from_email. */
  fromAddressSet: boolean;
  /** Set when at least one verified_email_domains row for this
   *  team has status='verified' AND matches the from_email's
   *  domain. */
  domainVerified: boolean;
}

/**
 * In-app setup checklist. Renders at the top of /teams/[id]/email
 * and walks the user through the six prerequisites with live
 * status. Each step is one of:
 *
 *   ok       — done; checkmark.
 *   todo     — not done yet; pending icon + setup CTA.
 *   blocked  — depends on a prior step that isn't done yet (e.g.
 *              "verify domain" is blocked by "save API key").
 *
 * Once every item is `ok`, the checklist collapses to a one-line
 * "All set" banner so it stops eating vertical space.
 */
export async function SetupChecklist({
  encryptionKeyConfigured,
  webhookSecretConfigured,
  apiKeySaved,
  fromAddressSet,
  domainVerified,
}: Props): Promise<React.JSX.Element> {
  const t = await getTranslations("messaging.setup");

  const items: ChecklistItem[] = [
    {
      id: "kek",
      status: encryptionKeyConfigured ? "ok" : "todo",
      title: t("kek.title"),
      detail: encryptionKeyConfigured
        ? t("kek.detailOk")
        : t("kek.detailTodo"),
      action: encryptionKeyConfigured
        ? undefined
        : {
            href: "/docs/guides/admin/email-setup#1-master-encryption-key-one-time-per-shyre-instance",
            label: t("kek.cta"),
          },
    },
    {
      id: "api_key",
      status: encryptionKeyConfigured
        ? apiKeySaved
          ? "ok"
          : "todo"
        : "blocked",
      title: t("apiKey.title"),
      detail: apiKeySaved
        ? t("apiKey.detailOk")
        : encryptionKeyConfigured
          ? t("apiKey.detailTodo")
          : t("apiKey.detailBlocked"),
      action: !apiKeySaved && encryptionKeyConfigured
        ? { href: "#config", label: t("apiKey.cta") }
        : undefined,
    },
    {
      id: "domain",
      status: !apiKeySaved
        ? "blocked"
        : domainVerified
          ? "ok"
          : "todo",
      title: t("domain.title"),
      detail: domainVerified
        ? t("domain.detailOk")
        : apiKeySaved
          ? t("domain.detailTodo")
          : t("domain.detailBlocked"),
      action:
        apiKeySaved && !domainVerified
          ? { href: "#domain", label: t("domain.cta") }
          : undefined,
    },
    {
      id: "from",
      status: !apiKeySaved
        ? "blocked"
        : fromAddressSet
          ? "ok"
          : "todo",
      title: t("from.title"),
      detail: fromAddressSet
        ? t("from.detailOk")
        : apiKeySaved
          ? t("from.detailTodo")
          : t("from.detailBlocked"),
      action:
        apiKeySaved && !fromAddressSet
          ? { href: "#config", label: t("from.cta") }
          : undefined,
    },
    {
      id: "webhook",
      status: webhookSecretConfigured ? "ok" : "todo",
      title: t("webhook.title"),
      detail: webhookSecretConfigured
        ? t("webhook.detailOk")
        : t("webhook.detailTodo"),
      action: webhookSecretConfigured
        ? undefined
        : {
            href: "/docs/guides/admin/email-setup#4-webhook-secret-one-time-per-shyre-instance",
            label: t("webhook.cta"),
          },
    },
    {
      id: "test",
      status:
        apiKeySaved && fromAddressSet && domainVerified ? "todo" : "blocked",
      title: t("test.title"),
      detail:
        apiKeySaved && fromAddressSet && domainVerified
          ? t("test.detailTodo")
          : t("test.detailBlocked"),
      action:
        apiKeySaved && fromAddressSet && domainVerified
          ? { href: "#config", label: t("test.cta") }
          : undefined,
    },
  ];

  const completedCount = items.filter((i) => i.status === "ok").length;
  const allDone = completedCount === items.length;

  if (allDone) {
    return (
      <section className="rounded-lg border border-success/40 bg-success-soft/20 p-3 flex items-center gap-2 text-body">
        <Check size={16} className="text-success" aria-hidden />
        <span className="text-content">{t("allDone")}</span>
        <Link
          href="/docs/guides/admin/email-setup"
          className="ml-auto inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
        >
          {t("docsLink")}
          <ExternalLink size={11} aria-hidden />
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("heading", { done: completedCount, total: items.length })}
        </h2>
        <Link
          href="/docs/guides/admin/email-setup"
          className="ml-auto inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
        >
          {t("docsLink")}
          <ExternalLink size={11} aria-hidden />
        </Link>
      </div>
      <ol className="space-y-2">
        {items.map((item, idx) => (
          <li key={item.id} className="flex items-start gap-3">
            <StatusIcon status={item.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-caption font-mono text-content-muted">
                  {idx + 1}.
                </span>
                <span
                  className={`text-body font-medium ${
                    item.status === "ok"
                      ? "text-content-muted line-through"
                      : item.status === "blocked"
                        ? "text-content-muted"
                        : "text-content"
                  }`}
                >
                  {item.title}
                </span>
              </div>
              <p className="text-caption text-content-muted mt-0.5">
                {item.detail}
              </p>
              {item.action && (
                <Link
                  href={item.action.href}
                  target={item.action.external ? "_blank" : undefined}
                  rel={
                    item.action.external ? "noopener noreferrer" : undefined
                  }
                  className="mt-1 inline-flex items-center gap-1 text-caption text-accent hover:underline"
                >
                  {item.action.label}
                  {item.action.external && <ExternalLink size={11} />}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StatusIcon({
  status,
}: {
  status: "ok" | "todo" | "blocked";
}): React.JSX.Element {
  if (status === "ok") {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success-soft text-success shrink-0">
        <Check size={12} aria-hidden />
      </span>
    );
  }
  if (status === "todo") {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning-soft text-warning shrink-0">
        <AlertCircle size={12} aria-hidden />
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-inset text-content-muted shrink-0">
      <Clock size={12} aria-hidden />
    </span>
  );
}
