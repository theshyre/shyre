import Link from "next/link";
import { AlertTriangle, KeyRound, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { scanCredentials, type CredentialItem } from "@/lib/credentials/scan";

/**
 * Dashboard banner that surfaces credentials expiring within 30
 * days (or already expired). Hides itself when nothing is in the
 * warning band — so a fully-rotated instance shows no banner at
 * all.
 *
 * Server component: runs the credential scan inline. RLS scopes
 * what each viewer can see (instance creds → system admin only;
 * team creds → team owner/admin; user creds → that user). A
 * solo-consultant-as-system-admin sees everything; a plain
 * member of a single team sees nothing they can act on.
 *
 * Drop into any page that's "dashboard-like" — the canonical
 * mount is the dashboard hero. Cap of 3 items keeps it from
 * eating the whole viewport when an instance has many teams.
 */
export async function ExpiringCredentialsBanner(): Promise<React.JSX.Element | null> {
  const supabase = await createClient();
  const items = await scanCredentials(supabase);

  // Only surface expired / critical / warning. `ok` items show up
  // on /system/credentials but not in the dashboard banner.
  const actionable = items.filter(
    (i) => i.severity !== "ok",
  );
  if (actionable.length === 0) return null;

  const visible = actionable.slice(0, 3);
  const remaining = actionable.length - visible.length;
  const tone = pickTone(visible);

  return (
    <section
      role="status"
      aria-live="polite"
      className={`rounded-lg border p-4 ${toneClasses(tone)}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-body-lg font-semibold">
              {tone === "expired"
                ? "Expired credentials"
                : "Credentials expiring soon"}
            </h2>
            <Link
              href="/system/credentials"
              className="inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
            >
              View all
              <ExternalLink size={11} aria-hidden />
            </Link>
          </div>
          <ul className="space-y-1.5 text-body">
            {visible.map((item) => (
              <li
                key={`${item.kind}:${item.scopeId ?? ""}`}
                className="flex items-center gap-2"
              >
                <KeyRound
                  size={12}
                  className="text-content-muted shrink-0"
                  aria-hidden
                />
                <span className="font-medium">{item.label}</span>
                <span className="text-content-muted">
                  {expiryPhrase(item)}
                </span>
                <Link
                  href={item.editUrl}
                  className="ml-auto text-caption text-accent hover:underline"
                >
                  Update →
                </Link>
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <p className="text-caption text-content-muted">
              + {remaining} more — see{" "}
              <Link
                href="/system/credentials"
                className="text-accent hover:underline"
              >
                /system/credentials
              </Link>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

type Tone = "expired" | "critical" | "warning";

function pickTone(items: CredentialItem[]): Tone {
  if (items.some((i) => i.severity === "expired")) return "expired";
  if (items.some((i) => i.severity === "critical")) return "critical";
  return "warning";
}

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "expired":
      return "border-error/40 bg-error-soft/20 text-content";
    case "critical":
      return "border-error/40 bg-error-soft/15 text-content";
    case "warning":
      return "border-warning/40 bg-warning-soft/30 text-content";
  }
}

function expiryPhrase(item: CredentialItem): string {
  const d = item.daysUntilExpiry;
  if (d == null) return "";
  if (d < 0) {
    const abs = Math.abs(d);
    return `expired ${abs} day${abs === 1 ? "" : "s"} ago`;
  }
  if (d === 0) return "expires today";
  return `expires in ${d} day${d === 1 ? "" : "s"}`;
}
