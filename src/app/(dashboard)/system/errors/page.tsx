import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { requireSystemAdmin } from "@/lib/system-admin";

export const metadata: Metadata = { title: "Error log" };
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  Info,
  Check,
  CheckCircle,
  Clock,
  Layers,
} from "lucide-react";
import { LocalDateTime } from "@theshyre/ui";
import { ResolveButton } from "./resolve-button";
import { ResolveAllButton } from "./resolve-all-button";
import { groupErrorRows, type ErrorLogRow } from "./group-errors";

const SEVERITY_CONFIG: Record<
  string,
  { icon: typeof AlertTriangle; color: string; bg: string }
> = {
  error: { icon: AlertTriangle, color: "text-error-text", bg: "bg-error-soft" },
  warning: { icon: AlertCircle, color: "text-warning-text", bg: "bg-warning-soft" },
  info: { icon: Info, color: "text-info-text", bg: "bg-info-soft" },
};

type SeverityScope = "error" | "warning" | "info";

function severityScope(value: string | undefined): SeverityScope | null {
  return value === "error" || value === "warning" || value === "info"
    ? value
    : null;
}

export default async function ErrorDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    severity?: string;
    resolved?: string;
    page?: string;
  }>;
}): Promise<React.JSX.Element> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const t = await getTranslations("admin.errorLog");
  const params = await searchParams;

  const page = parseInt(params.page ?? "1", 10);
  const perPage = 25;
  const offset = (page - 1) * perPage;

  let query = supabase
    .from("error_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + perPage - 1);

  if (params.severity && params.severity !== "all") {
    query = query.eq("severity", params.severity);
  }

  const showsUnresolved = params.resolved !== "true";
  if (params.resolved === "true") {
    query = query.not("resolved_at", "is", null);
  } else if (params.resolved !== "all") {
    query = query.is("resolved_at", null);
  }

  const { data: errors, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / perPage);

  // Unresolved count (unscoped — the header badge).
  const { count: unresolvedCount } = await supabase
    .from("error_logs")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);

  // What "Resolve all" would sweep: unresolved rows within the active
  // severity scope. Reuses the badge count when unscoped.
  const scope = severityScope(params.severity);
  let resolvableCount = unresolvedCount ?? 0;
  if (scope) {
    const { count: scopedCount } = await supabase
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("severity", scope);
    resolvableCount = scopedCount ?? 0;
  }

  const rows: ErrorLogRow[] = errors ?? [];
  const groups = groupErrorRows(rows);

  return (
    <div>
      <div className="flex items-center gap-3">
        <Shield size={24} className="text-accent" aria-hidden="true" />
        <h1 className="text-page-title font-bold text-content">{t("title")}</h1>
        {(unresolvedCount ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-error-soft px-2.5 py-0.5 text-caption font-medium text-error-text">
            <AlertTriangle size={12} aria-hidden="true" />
            {t("unresolvedBadge", { count: unresolvedCount ?? 0 })}
          </span>
        )}
        <div className="ml-auto">
          {showsUnresolved && resolvableCount > 0 && (
            <ResolveAllButton severity={scope} count={resolvableCount} />
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex gap-2 flex-wrap">
        <FilterLink
          href="/system/errors"
          label={t("filters.unresolved")}
          active={
            !params.severity &&
            params.resolved !== "all" &&
            params.resolved !== "true"
          }
        />
        <FilterLink
          href="/system/errors?resolved=all"
          label={t("filters.all")}
          active={params.resolved === "all"}
        />
        <FilterLink
          href="/system/errors?severity=error"
          label={t("filters.errors")}
          active={params.severity === "error"}
        />
        <FilterLink
          href="/system/errors?severity=warning"
          label={t("filters.warnings")}
          active={params.severity === "warning"}
        />
        <FilterLink
          href="/system/errors?resolved=true"
          label={t("filters.resolved")}
          active={params.resolved === "true"}
        />
      </div>

      {/* Grouped error cards */}
      {groups.length > 0 ? (
        <div className="mt-6 space-y-3">
          {groups.map((group) => {
            const err = group.newest;
            const config = SEVERITY_CONFIG[err.severity] ?? SEVERITY_CONFIG.error;
            const Icon = config?.icon ?? AlertTriangle;

            return (
              <details
                key={group.key}
                className="rounded-lg border border-edge bg-surface-raised overflow-hidden"
              >
                <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-hover transition-colors">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config?.bg ?? ""}`}
                  >
                    <Icon size={14} className={config?.color ?? ""} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-caption font-mono text-accent">
                        {err.error_code}
                      </span>
                      {group.count > 1 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface-inset px-2 py-0.5 text-label font-semibold text-content-secondary"
                          aria-label={t("occurrenceBadgeLabel", {
                            count: group.count,
                          })}
                        >
                          <Layers size={8} aria-hidden="true" />
                          {t("occurrenceBadge", { count: group.count })}
                        </span>
                      )}
                      {group.allResolved && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-label text-success-text">
                          <CheckCircle size={8} aria-hidden="true" />
                          {t("resolvedChip")}
                        </span>
                      )}
                    </div>
                    <p className="text-body text-content truncate">
                      {err.message}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-caption text-content-muted flex items-center justify-end gap-1">
                      <Clock size={10} aria-hidden="true" />
                      {group.count > 1 ? (
                        <>
                          {t("lastSeen")}{" "}
                          <LocalDateTime value={group.lastSeen} />
                        </>
                      ) : (
                        <LocalDateTime value={group.lastSeen} />
                      )}
                    </p>
                    {group.count > 1 && (
                      <p className="text-label text-content-muted">
                        {t("firstSeen")} <LocalDateTime value={group.firstSeen} />
                      </p>
                    )}
                    {err.action && (
                      <p className="text-label text-content-muted font-mono">
                        {err.action}
                      </p>
                    )}
                  </div>
                </summary>

                <div className="border-t border-edge px-4 py-3 space-y-3 bg-surface-inset">
                  <div className="grid gap-2 sm:grid-cols-2 text-caption">
                    <div>
                      <span className="text-content-muted">{t("fieldErrorCode")}:</span>{" "}
                      <span className="font-mono text-content">{err.error_code}</span>
                    </div>
                    <div>
                      <span className="text-content-muted">{t("fieldSeverity")}:</span>{" "}
                      <span className={`font-medium ${config?.color ?? ""}`}>
                        {err.severity}
                      </span>
                    </div>
                    <div>
                      <span className="text-content-muted">{t("fieldUserId")}:</span>{" "}
                      <span className="font-mono text-content">{err.user_id ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-content-muted">{t("fieldOrgId")}:</span>{" "}
                      <span className="font-mono text-content">{err.team_id ?? "—"}</span>
                    </div>
                    {err.url && (
                      <div className="sm:col-span-2">
                        <span className="text-content-muted">{t("fieldUrl")}:</span>{" "}
                        <span className="font-mono text-content">{err.url}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-caption text-content-muted mb-1">
                      {t("fieldMessage")}:
                    </p>
                    <p className="text-body text-content">{err.message}</p>
                  </div>

                  {group.details && Object.keys(group.details).length > 0 && (
                    <div>
                      <p className="text-caption text-content-muted mb-1">
                        {t("fieldDetails")}:
                      </p>
                      <pre className="text-caption text-content font-mono bg-surface rounded-lg p-2 overflow-x-auto">
                        {JSON.stringify(group.details, null, 2)}
                      </pre>
                    </div>
                  )}

                  {group.stackTrace && (
                    <div>
                      <p className="text-caption text-content-muted mb-1">
                        {t("fieldStackTrace")}:
                      </p>
                      <pre className="text-caption text-content-muted font-mono bg-surface rounded-lg p-2 overflow-x-auto max-h-[192px]">
                        {group.stackTrace}
                      </pre>
                    </div>
                  )}

                  {group.count > 1 && (
                    <div>
                      <p className="text-caption text-content-muted mb-1">
                        {t("occurrencesTitle", { count: group.count })}:
                      </p>
                      <ul className="space-y-1">
                        {group.occurrences.map((occ) => (
                          <li
                            key={occ.id}
                            className="flex items-center gap-2 text-caption text-content-secondary"
                          >
                            <Clock size={10} aria-hidden="true" />
                            <LocalDateTime value={occ.created_at} />
                            {occ.resolved_at !== null && (
                              <span className="inline-flex items-center gap-1 text-label text-success-text">
                                <CheckCircle size={8} aria-hidden="true" />
                                {t("resolvedChip")}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!group.allResolved && (
                    <ResolveButton errorIds={group.unresolvedIds} />
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="mt-6 text-body text-content-muted">{t("empty")}</p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex gap-2 justify-center">
          {Array.from({ length: totalPages }, (_, i) => (
            <a
              key={i}
              href={`/system/errors?page=${i + 1}${params.severity ? `&severity=${params.severity}` : ""}${params.resolved ? `&resolved=${params.resolved}` : ""}`}
              className={`px-3 py-1 rounded text-body ${
                page === i + 1
                  ? "bg-accent text-content-inverse"
                  : "bg-surface-inset text-content-secondary hover:bg-hover"
              }`}
              aria-current={page === i + 1 ? "page" : undefined}
            >
              {i + 1}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Filter pill — a link, not a dropdown (five fixed views), but wearing
 * the standard chip grammar from `<FilterChip>`: rounded-full bordered
 * chip, accent-soft when active, check icon + `aria-current` so the
 * active state never rides on color alone.
 */
function FilterLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}): React.JSX.Element {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-medium border transition-colors ${
        active
          ? "bg-accent-soft text-accent-text border-accent/30"
          : "bg-surface-inset text-content-secondary border-edge hover:bg-hover"
      }`}
    >
      {active && <Check size={12} aria-hidden="true" />}
      {label}
    </a>
  );
}
