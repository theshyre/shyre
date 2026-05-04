import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Check, AlertCircle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  scanCredentials,
  type CredentialItem,
  type Severity,
} from "@/lib/credentials/scan";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Credentials" };
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
  const supabase = await createClient();
  const items = await scanCredentials(supabase);

  const expired = items.filter((i) => i.severity === "expired");
  const critical = items.filter((i) => i.severity === "critical");
  const warning = items.filter((i) => i.severity === "warning");
  const ok = items.filter((i) => i.severity === "ok");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <KeyRound size={24} className="text-accent" />
        <h1 className="text-page-title font-bold text-content">Credentials</h1>
      </div>
      <p className="text-body text-content-secondary max-w-2xl">
        Every API token and key Shyre tracks across this instance. Sorted by
        urgency — expired first. Click any row to jump to the form that
        rotates it.
      </p>

      {items.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface-raised p-4 text-body text-content-muted">
          No credentials configured yet. Visit{" "}
          <Link href="/system/deploy" className="text-accent hover:underline">
            /system/deploy
          </Link>{" "}
          to connect Vercel and provision the encryption key.
        </p>
      ) : (
        <div className="space-y-4">
          {expired.length > 0 && (
            <CredentialGroup
              title="Expired"
              items={expired}
              severity="expired"
            />
          )}
          {critical.length > 0 && (
            <CredentialGroup
              title="Expiring within 7 days"
              items={critical}
              severity="critical"
            />
          )}
          {warning.length > 0 && (
            <CredentialGroup
              title="Expiring within 30 days"
              items={warning}
              severity="warning"
            />
          )}
          {ok.length > 0 && (
            <CredentialGroup
              title="Healthy"
              items={ok}
              severity="ok"
            />
          )}
        </div>
      )}
    </div>
  );
}

function CredentialGroup({
  title,
  items,
  severity,
}: {
  title: string;
  items: CredentialItem[];
  severity: Severity;
}): React.JSX.Element {
  return (
    <section
      className={`rounded-lg border p-4 space-y-2 ${groupBorder(severity)}`}
    >
      <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
        {title} ({items.length})
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
                    {expiryPhrase(item)} · expires {item.expiresAt}
                  </>
                ) : (
                  <>No rotate-by date set — pick one to enable reminders</>
                )}
              </p>
            </div>
            <span className="text-caption text-content-muted hidden sm:inline">
              {scopeLabel(item)}
            </span>
            <Link
              href={item.editUrl}
              className="text-caption text-accent hover:underline shrink-0"
            >
              Update →
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
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success-soft text-success shrink-0">
        <Check size={12} aria-hidden />
      </span>
    );
  }
  if (severity === "warning") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-warning-soft text-warning shrink-0">
        <Clock size={12} aria-hidden />
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-error-soft text-error shrink-0">
      <AlertCircle size={12} aria-hidden />
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

function expiryPhrase(item: CredentialItem): string {
  const d = item.daysUntilExpiry;
  if (d == null) return "no expiration set";
  if (d < 0) {
    const abs = Math.abs(d);
    return `expired ${abs} day${abs === 1 ? "" : "s"} ago`;
  }
  if (d === 0) return "expires today";
  return `${d} day${d === 1 ? "" : "s"} until expiry`;
}

function scopeLabel(item: CredentialItem): string {
  switch (item.scope) {
    case "instance":
      return "Instance";
    case "team":
      return "Team";
    case "user":
      return "Your account";
  }
}
