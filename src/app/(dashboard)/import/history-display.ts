/**
 * Pure display helpers for the Import History UI. Extracted so the
 * string-munging + status logic can be tested without wrapping a
 * React renderer — the component just passes its props through these.
 */

import type { ImportRunRow } from "./import-history";

export type StatusKind =
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "undone";

/** Resolve the effective status for display. Undone always wins over
 * the underlying status (a completed-then-undone row reads as "Undone").
 *
 * A run is "partial" when:
 *   - status === "completed", AND
 *   - the importer collected any errors during the run, OR
 *   - reconciliation says the count from the source doesn't match
 *     what landed in Shyre.
 *
 * The Harvest importer's per-batch error path is the exact case
 * the user just hit: 200 of 223 entries got rejected by RLS, but
 * the run completed (the rejections were collected, not thrown).
 * Without a partial state the user reads the green "Imported"
 * badge and assumes everything landed.
 */
export function effectiveStatusKind(run: {
  status: ImportRunRow["status"];
  undone_at: string | null;
  summary?: ImportRunRow["summary"];
}): StatusKind {
  if (run.undone_at) return "undone";
  if (run.status === "completed") {
    const errs = run.summary?.errors;
    if (errs && errs.length > 0) return "partial";
    const recon = run.summary?.reconciliation;
    if (recon && recon.match === false) return "partial";
  }
  return run.status;
}

/**
 * Build the count-string list for the row header
 * (e.g. ["42 customers", "15 projects", "1200 time entries"]).
 * Only non-zero counts are returned.
 *
 * `labels` is passed in (rather than hardcoded) so the caller can
 * run it through next-intl's ICU-plural formatter for locale-
 * correct singulars ("1 customer") vs. plurals.
 */
export function buildCountsList(
  summary: ImportRunRow["summary"],
  labels: {
    customer: (n: number) => string;
    project: (n: number) => string;
    timeEntry: (n: number) => string;
    expense: (n: number) => string;
  },
): string[] {
  const out: string[] = [];
  const imp = summary?.imported;
  if (!imp) return out;

  if (imp.customers && imp.customers > 0) {
    out.push(`${imp.customers} ${labels.customer(imp.customers)}`);
  }
  if (imp.projects && imp.projects > 0) {
    out.push(`${imp.projects} ${labels.project(imp.projects)}`);
  }
  if (imp.timeEntries && imp.timeEntries > 0) {
    out.push(`${imp.timeEntries} ${labels.timeEntry(imp.timeEntries)}`);
  }
  if (imp.expenses && imp.expenses > 0) {
    out.push(`${imp.expenses} ${labels.expense(imp.expenses)}`);
  }

  return out;
}

/**
 * Source label for a run — "Harvest" alone when no account id is
 * stored, "Harvest · 123456" when it is. Currently only Harvest is
 * supported as an importer; adding more providers would map their
 * ids here.
 */
export function sourceLabel(run: {
  imported_from: string;
  source_account_identifier: string | null;
}): string {
  const base =
    run.imported_from === "harvest"
      ? "Harvest"
      : run.imported_from === "csv-expenses"
        ? "Expenses CSV"
        : run.imported_from === "csv-company-time-log"
          ? "Company time log CSV"
          : // Capitalize the first letter as a fallback.
            run.imported_from.charAt(0).toUpperCase() +
            run.imported_from.slice(1);
  if (run.source_account_identifier) {
    return `${base} · ${run.source_account_identifier}`;
  }
  return base;
}

/**
 * Format the "why were N entries skipped" breakdown for the import-
 * history row. Mirrors the per-reason list on the post-import
 * DoneStep card so the two screens stay in lockstep.
 *
 * Returns "" (not null) when there are no reasons — caller renders
 * the count alone in that case.
 *
 * Reasons are emitted in descending count order so the most
 * prevalent skip class shows first ("23 invoice_locked · 1 duplicate"),
 * which is what the user wants to see when scanning a row.
 */
export function formatSkipBreakdown(
  reasons: Record<string, number> | undefined,
): string {
  if (!reasons) return "";
  const entries = Object.entries(reasons).filter(([, count]) => count > 0);
  if (entries.length === 0) return "";
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([reason, count]) => `${count} ${reason}`).join(" · ");
}

/**
 * Whether an undo button should render for this row given the
 * caller's role in the owning team. We render only when:
 *   - the run is not already undone, and
 *   - the caller is an owner/admin on the team that owns the run.
 *
 * The server action re-checks this and rejects mismatches, so the
 * UI check is purely cosmetic — no security consequence if we flip
 * it the wrong way.
 */
export function canRenderUndo(
  run: { undone_at: string | null; status: StatusKind | ImportRunRow["status"] },
  callerIsTeamAdmin: boolean,
): boolean {
  if (run.undone_at) return false;
  if (run.status === "running") return false;
  return callerIsTeamAdmin;
}
