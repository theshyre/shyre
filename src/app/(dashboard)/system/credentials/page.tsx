import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { KeyRound, Check, AlertCircle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSystemAdmin } from "@/lib/system-admin";
import { formatDisplayDate } from "@/lib/format-date";
import {
  scanCredentials,
  type CredentialItem,
  type Severity,
} from "@/lib/credentials/scan";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.credentialsPage");
  return { title: t("title") };
}

/**
 * /system/credentials — every credential Shyre tracks, in one
 * list, with rotate-by status. System admin only (gated by the
 * /system layout).
 *
 * Includes credentials that have NO rotate-by date set (severity
 * "ok"). Listing them is the whole point — the system admin can
 * notice "wait, my Vercel token has no rotate date" and fix it.
 */
export default async function SystemCredentialsPage(): Promise<React.JSX.Element> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const items = await scanCredentials(supabase);
  const t = await getTranslations("admin.credentialsPage");

  const expired = items.filter((i) => i.severity === "expired");
  const critical = items.filter((i) => i.severity === "critical");
  const warning = items.filter((i) => i.severity === "warning");
  const ok = items.filter((i) => i.severity === "ok");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <KeyRound size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
      </div>
      <p className="text-body text-content-secondary max-w-2xl">
        {t("description")}
      </p>

      {items.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-4 text-body text-content-muted">
          {t("emptyBefore")}{" "}
          <Link href="/system/deploy" className="text-accent hover:underline">
            /system/deploy
          </Link>{" "}
          {t("emptyAfter")}
        </p>
      ) : (
        <div className="space-y-4">
          {expired.length > 0 && (
            <CredentialGroup
              title={t("groups.expired")}
              items={expired}
              severity="expired"
              t={t}
            />
          )}
          {critical.length > 0 && (
            <CredentialGroup
              title={t("groups.critical")}
              items={critical}
              severity="critical"
              t={t}
            />
          )}
          {warning.length > 0 && (
            <CredentialGroup
              title={t("groups.warning")}
              items={warning}
              severity="warning"
              t={t}
            />
          )}
          {ok.length > 0 && (
            <CredentialGroup
              title={t("groups.ok")}
              items={ok}
              severity="ok"
              t={t}
            />
          )}
        </div>
      )}
    </div>
  );
}

type PageTranslator = Awaited<ReturnType<typeof getTranslations>>;

function CredentialGroup({
  title,
  items,
  severity,
  t,
}: {
  title: string;
  items: CredentialItem[];
  severity: Severity;
  t: PageTranslator;
}): React.JSX.Element {
  return (
    <section
      className={`rounded-lg border p-4 space-y-2 ${groupBorder(severity)}`}
    >
      <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
        {t("sectionHeading", { label: title, count: items.length })}
      </h2>
      <ul className="divide-y divide-edge-muted">
        {items.map((item) => (
          <li
            key={`${item.kind}:${item.scopeId ?? ""}`}
            className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
          >
            <SeverityIcon severity={item.severity} />
            <div className="flex-1 min-w-0">
              <p className="text-body font-medium text-content truncate">
                {item.label}
              </p>
              <p className="text-caption text-content-muted">
                {item.expiresAt ? (
                  <>
                    {expiryPhrase(item, t)} ·{" "}
                    {t("expiresLabel", { date: formatDisplayDate(item.expiresAt) })}
                  </>
                ) : (
                  <>{t("noRotateDate")}</>
                )}
              </p>
            </div>
            <span className="text-caption text-content-muted hidden sm:inline">
              {scopeLabel(item, t)}
            </span>
            <Link
              href={item.editUrl}
              className="text-caption text-accent hover:underline shrink-0"
            >
              {t("update")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeverityIcon({
  severity,
}: {
  severity: Severity;
}): React.JSX.Element {
  if (severity === "ok") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success-soft text-success-text shrink-0">
        <Check size={12} aria-hidden="true" />
      </span>
    );
  }
  if (severity === "warning") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-warning-soft text-warning-text shrink-0">
        <Clock size={12} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-error-soft text-error-text shrink-0">
      <AlertCircle size={12} aria-hidden="true" />
    </span>
  );
}

function groupBorder(severity: Severity): string {
  switch (severity) {
    case "expired":
    case "critical":
      return "border-error/40 bg-surface-raised";
    case "warning":
      return "border-warning/40 bg-surface-raised";
    case "ok":
      return "border-edge bg-surface-raised";
  }
}

/** Exported for testing — the ICU plural rules live in the message
 *  catalog (admin.credentialsPage.expiry.*), this just picks the
 *  right key + count. */
export function expiryPhrase(
  item: Pick<CredentialItem, "daysUntilExpiry">,
  t: PageTranslator,
): string {
  const d = item.daysUntilExpiry;
  if (d == null) return t("expiry.noExpiration");
  if (d < 0) return t("expiry.expiredAgo", { count: Math.abs(d) });
  if (d === 0) return t("expiry.expiresToday");
  return t("expiry.untilExpiry", { count: d });
}

function scopeLabel(item: Pick<CredentialItem, "scope">, t: PageTranslator): string {
  return t(`scope.${item.scope}`);
}
