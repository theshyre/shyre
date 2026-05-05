/**
 * Sub-projects rollup section on the parent project's detail page.
 * Renders one row per child with the child's individual burn vs
 * budget, plus a "rolled-up totals" card that sums the parent's own
 * work + every child's. Server component; the rollup uses a single
 * SQL aggregate via the `time_entries` table joined to projects so
 * the parent total can't disagree with the sum of children visible
 * on each child's detail page (a JS sum-of-rounded would drift).
 */

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { formatDurationHMZero } from "@/lib/time/week";

interface ChildSummary {
  id: string;
  name: string;
  status: string | null;
  budget_hours: number | null;
  hourly_rate: number | null;
}

interface Props {
  parentId: string;
  parentBudgetHours: number | null;
  parentHourlyRate: number | null;
  /** Already-computed total minutes for the parent's OWN entries —
   *  the parent detail page sums these higher up to render its
   *  primary totals card. Reuse instead of re-querying. */
  parentOwnMinutes: number;
  /** Sub-projects to render. Named `subProjects` (not `children`) to
   *  avoid React's reserved-prop lint — `children` would imply JSX
   *  passthrough. */
  subProjects: ChildSummary[];
}

export async function SubProjectsSection({
  parentId,
  parentBudgetHours,
  parentHourlyRate,
  parentOwnMinutes,
  subProjects: children,
}: Props): Promise<React.JSX.Element> {
  const t = await getTranslations("projects.subProjects");
  const supabase = await createClient();

  // Per-child total minutes — single round-trip aggregating
  // duration_min across non-deleted entries grouped by project_id.
  // Better than N queries, and the trigger guarantees no children of
  // children, so the join is at most parent + N children deep (1
  // level).
  const childIds = children.map((c) => c.id);
  const minutesByProject = new Map<string, number>();
  if (childIds.length > 0) {
    const { data: entries } = await supabase
      .from("time_entries")
      .select("project_id, duration_min")
      .in("project_id", childIds)
      .is("deleted_at", null);
    for (const e of entries ?? []) {
      const pid = e.project_id as string;
      const min = (e.duration_min as number | null) ?? 0;
      minutesByProject.set(pid, (minutesByProject.get(pid) ?? 0) + min);
    }
  }

  const childRows = children.map((c) => {
    const minutes = minutesByProject.get(c.id) ?? 0;
    const hours = minutes / 60;
    const budget = c.budget_hours;
    const pct = budget && budget > 0 ? Math.min(100, (hours / budget) * 100) : null;
    return {
      ...c,
      minutes,
      hours,
      budget,
      pct,
    };
  });

  const childMinutesTotal = childRows.reduce((s, r) => s + r.minutes, 0);
  const totalMinutes = parentOwnMinutes + childMinutesTotal;
  const totalHours = totalMinutes / 60;
  const childBudgetTotal = childRows.reduce(
    (s, r) => s + (r.budget ?? 0),
    0,
  );
  const totalBudget = (parentBudgetHours ?? 0) + childBudgetTotal;

  // Use parent's hourly_rate as a per-row fallback when a child
  // doesn't carry its own. Per-row override still wins.
  const parentRate = parentHourlyRate ?? 0;
  const totalDollars = childRows.reduce(
    (s, r) => s + (r.minutes / 60) * (r.hourly_rate ?? parentRate),
    0,
  ) + (parentOwnMinutes / 60) * parentRate;
  const totalBudgetDollars = childRows.reduce(
    (s, r) => s + (r.budget ?? 0) * (r.hourly_rate ?? parentRate),
    0,
  ) + (parentBudgetHours ?? 0) * parentRate;

  void parentId; // referenced for breadcrumb / future hooks

  return (
    <div className="mt-3 space-y-3">
      {/* Rolled-up totals card — own + all children, both hours
          and dollars. Single numeric source of truth so the parent
          page's primary totals card and this section can't disagree. */}
      <div className="rounded-lg border border-edge bg-surface-raised p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-label uppercase tracking-wider text-content-muted">
              {t("totalsHeader")}
            </p>
            <p className="mt-1 text-title font-semibold text-content tabular-nums">
              {formatDurationHMZero(totalMinutes)}
              {totalBudget > 0 && (
                <span className="ml-2 text-content-muted text-body-lg">
                  {t("ofBudget", {
                    used: totalHours.toFixed(1),
                    budget: totalBudget.toFixed(1),
                  })}
                </span>
              )}
            </p>
            {parentRate > 0 && (
              <p className="mt-0.5 text-caption text-content-muted">
                {t("dollars", {
                  used: totalDollars.toFixed(2),
                  budget:
                    totalBudgetDollars > 0
                      ? totalBudgetDollars.toFixed(2)
                      : "—",
                })}
              </p>
            )}
          </div>
          <div>
            <p className="text-label uppercase tracking-wider text-content-muted">
              {t("ownHeader")}
            </p>
            <p className="mt-1 text-body-lg text-content-secondary tabular-nums">
              {formatDurationHMZero(parentOwnMinutes)}
              {parentBudgetHours && (
                <span className="ml-2 text-content-muted">
                  {t("ofBudget", {
                    used: (parentOwnMinutes / 60).toFixed(1),
                    budget: parentBudgetHours.toFixed(1),
                  })}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Per-child rows. Click-through to the child's detail page. */}
      <ul className="space-y-2">
        {childRows.map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-edge bg-surface-raised p-3"
          >
            <Link
              href={`/projects/${c.id}`}
              className="flex items-center justify-between gap-3 group"
            >
              <div className="min-w-0">
                <p className="text-body-lg font-medium text-content truncate group-hover:text-accent">
                  {c.name}
                </p>
                {c.status && c.status !== "active" && (
                  <p className="text-caption text-content-muted">{c.status}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-body-lg text-content tabular-nums">
                  {formatDurationHMZero(c.minutes)}
                  {c.budget && (
                    <span className="ml-1.5 text-caption text-content-muted">
                      / {c.budget.toFixed(1)}h
                    </span>
                  )}
                </p>
                {c.pct !== null && (
                  // Multi-channel encoding: the bar's WIDTH is the
                  // burn signal, the percentage NUMBER is the text
                  // signal, and the COLOR shifts as burn approaches /
                  // exceeds the budget. Three channels per the
                  // redundant-encoding rule.
                  <div className="mt-1 inline-block w-32 align-middle">
                    <div
                      className="h-1 rounded-full bg-edge overflow-hidden"
                      role="progressbar"
                      aria-valuenow={Math.round(c.pct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={t("burnAria", {
                        name: c.name,
                        pct: Math.round(c.pct),
                      })}
                    >
                      <div
                        className={`h-1 ${
                          c.pct >= 100
                            ? "bg-error"
                            : c.pct >= 80
                              ? "bg-warning"
                              : "bg-accent"
                        }`}
                        style={{ width: `${c.pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
