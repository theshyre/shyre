import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireSystemAdmin } from "@/lib/system-admin";

export const metadata: Metadata = { title: "Error log" };
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  Clock,
} from "lucide-react";
import { ResolveButton } from "./resolve-button";
import { LocalDateTime } from "@/components/LocalDateTime";

const SEVERITY_CONFIG: Record<
  string,
  { icon: typeof AlertTriangle; color: string; bg: string }
> = {
  error: { icon: AlertTriangle, color: "text-error", bg: "bg-error-soft" },
  warning: { icon: AlertCircle, color: "text-warning", bg: "bg-warning-soft" },
  info: { icon: Info, color: "text-info", bg: "bg-info-soft" },
};

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

  if (params.resolved === "true") {
    query = query.not("resolved_at", "is", null);
  } else if (params.resolved !== "all") {
    query = query.is("resolved_at", null);
  }

  const { data: errors, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / perPage);

  // Unresolved count
  const { count: unresolvedCount } = await supabase
    .from("error_logs")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);

  return (
    <div>
      <div className="flex items-center gap-3">
        <Shield size={24} className="text-accent" />
        <h1 className="text-2xl font-bold text-content">Error Log</h1>
        {(unresolvedCount ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-error-soft px-2.5 py-0.5 text-xs font-medium text-error">
            <AlertTriangle size={12} />
            {unresolvedCount} unresolved
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="mt-4 flex gap-2 flex-wrap">
        <FilterLink
          href="/system/errors"
          label="Unresolved"
          active={!params.severity && params.resolved !== "all" && params.resolved !== "true"}
        />
        <FilterLink
          href="/system/errors?resolved=all"
          label="All"
          active={params.resolved === "all"}
        />
        <FilterLink
          href="/system/errors?severity=error"
          label="Errors"
          active={params.severity === "error"}
        />
        <FilterLink
          href="/system/errors?severity=warning"
          label="Warnings"
          active={params.severity === "warning"}
        />
        <FilterLink
          href="/system/errors?resolved=true"
          label="Resolved"
          active={params.resolved === "true"}
        />
      </div>

      {/* Error list */}
      {errors && errors.length > 0 ? (
        <div className="mt-6 space-y-3">
          {errors.map((err) => {
            const config = SEVERITY_CONFIG[err.severity] ?? SEVERITY_CONFIG.error;
            const Icon = config?.icon ?? AlertTriangle;
            const isResolved = err.resolved_at !== null;

            return (
              <details
                key={err.id}
                className="rounded-lg border border-edge bg-surface-raised overflow-hidden"
              >
                <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-hover transition-colors">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${config?.bg ?? ""}`}>
                    <Icon size={14} className={config?.color ?? ""} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-accent">
                        {err.error_code}
                      </span>
                      {isResolved && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10px] text-success">
                          <CheckCircle size={8} />
                          Resolved
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-content truncate">
                      {err.message}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-content-muted flex items-center gap-1">
                      <Clock size={10} />
                      <LocalDateTime value={err.created_at} />
                    </p>
                    {err.action && (
                      <p className="text-[10px] text-content-muted font-mono">
                        {err.action}
                      </p>
                    )}
                  </div>
                </summary>

                <div className="border-t border-edge px-4 py-3 space-y-3 bg-surface-inset">
                  <div className="grid gap-2 sm:grid-cols-2 text-xs">
                    <div>
                      <span className="text-content-muted">Error Code:</span>{" "}
                      <span className="font-mono text-content">{err.error_code}</span>
                    </div>
                    <div>
                      <span className="text-content-muted">Severity:</span>{" "}
                      <span className={`font-medium ${config?.color ?? ""}`}>{err.severity}</span>
                    </div>
                    <div>
                      <span className="text-content-muted">User ID:</span>{" "}
                      <span className="font-mono text-content">{err.user_id ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-content-muted">Org ID:</span>{" "}
                      <span className="font-mono text-content">{err.team_id ?? "—"}</span>
                    </div>
                    {err.url && (
                      <div className="sm:col-span-2">
                        <span className="text-content-muted">URL:</span>{" "}
                        <span className="font-mono text-content">{err.url}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs text-content-muted mb-1">Message:</p>
                    <p className="text-sm text-content">{err.message}</p>
                  </div>

                  {err.details && Object.keys(err.details as object).length > 0 && (
                    <div>
                      <p className="text-xs text-content-muted mb-1">Details:</p>
                      <pre className="text-xs text-content font-mono bg-surface rounded-lg p-2 overflow-x-auto">
                        {JSON.stringify(err.details, null, 2)}
                      </pre>
                    </div>
                  )}

                  {err.stack_trace && (
                    <div>
                      <p className="text-xs text-content-muted mb-1">Stack Trace:</p>
                      <pre className="text-xs text-content-muted font-mono bg-surface rounded-lg p-2 overflow-x-auto max-h-[192px]">
                        {err.stack_trace}
                      </pre>
                    </div>
                  )}

                  {!isResolved && (
                    <ResolveButton errorId={err.id} />
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="mt-6 text-sm text-content-muted">No errors found.</p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex gap-2 justify-center">
          {Array.from({ length: totalPages }, (_, i) => (
            <a
              key={i}
              href={`/system/errors?page=${i + 1}${params.severity ? `&severity=${params.severity}` : ""}${params.resolved ? `&resolved=${params.resolved}` : ""}`}
              className={`px-3 py-1 rounded text-sm ${
                page === i + 1
                  ? "bg-accent text-content-inverse"
                  : "bg-surface-inset text-content-secondary hover:bg-hover"
              }`}
            >
              {i + 1}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

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
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-accent-soft text-accent-text"
          : "bg-surface-inset text-content-secondary hover:bg-hover"
      }`}
    >
      {label}
    </a>
  );
}
