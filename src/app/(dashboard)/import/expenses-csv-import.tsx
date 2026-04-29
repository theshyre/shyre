"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  FileText,
  Receipt,
  Upload,
} from "lucide-react";
import { Spinner } from "@theshyre/ui";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  selectClass,
  textareaClass,
  labelClass,
} from "@/lib/form-styles";
import type { TeamListItem } from "@/lib/team-context";
import { parseExpenseCsv } from "@/lib/expense-csv-import";
import { importExpensesCsvAction } from "./expenses/actions";

interface Props {
  teams: TeamListItem[];
}

interface CommitSummary {
  importedCount: number;
  skipped: number;
  alreadyImported: number;
  errors: string[];
  skippedReasons: Array<{ rowNumber: number; reason: string }>;
  importRunId: string;
}

/**
 * Bulk-import expenses from a CSV. The CSV shape is dictated by the
 * historical expense spreadsheet (Date / Amount / Item / Comments)
 * — see `parseExpenseCsv` for the full alias list.
 *
 * Two-stage UX:
 *   1. User pastes CSV (or uploads a .csv file). Client-side parser
 *      renders a preview: first 3 rows, total / skipped counts, and
 *      a banner explaining the default category convention.
 *   2. User confirms. The form action runs the same parser
 *      server-side (don't trust the client) and writes to expenses
 *      with idempotency via import_source_id.
 *
 * The whole component is a single <form> so the browser's native
 * Enter-to-submit + the existing autosave / SubmitButton patterns
 * still apply. No useTransition / useFormAction wrapping — the
 * server action returns a fully-typed result we render inline as
 * the "done" step.
 */
export function ExpensesCsvImport({ teams }: Props): React.JSX.Element {
  const writableTeams = teams.filter(
    (t) => t.role === "owner" || t.role === "admin",
  );
  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    writableTeams[0]?.id ?? "",
  );
  const [csvText, setCsvText] = useState("");
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsePreview = useMemo(() => {
    if (!csvText.trim()) return null;
    return parseExpenseCsv(csvText);
  }, [csvText]);

  if (writableTeams.length === 0) {
    return (
      <section className="rounded-lg border border-edge bg-surface-raised p-4 mt-6">
        <header className="flex items-center gap-2">
          <Receipt size={16} className="text-accent" />
          <h2 className="text-body-lg font-semibold text-content">
            Import expenses from CSV
          </h2>
        </header>
        <p className="mt-2 text-caption text-content-muted">
          You need owner or admin role on at least one team to run an
          import.
        </p>
      </section>
    );
  }

  if (summary) {
    return (
      <section className="rounded-lg border border-success/40 bg-success-soft/20 p-4 mt-6 space-y-3">
        <header className="flex items-center gap-2">
          <CheckCircle size={16} className="text-success" />
          <h2 className="text-body-lg font-semibold text-content">
            Expense import complete
          </h2>
        </header>
        <ul className="text-body text-content-secondary space-y-1">
          <li>
            <strong className="font-mono text-content">
              {summary.importedCount}
            </strong>{" "}
            new expense{summary.importedCount === 1 ? "" : "s"} imported
          </li>
          {summary.alreadyImported > 0 && (
            <li>
              <strong className="font-mono text-content">
                {summary.alreadyImported}
              </strong>{" "}
              already imported (deduped via the source-id hash)
            </li>
          )}
          {summary.skipped > 0 && (
            <li className="text-warning">
              <strong className="font-mono">{summary.skipped}</strong>{" "}
              row{summary.skipped === 1 ? "" : "s"} skipped — see details
              below
            </li>
          )}
          {summary.errors.length > 0 && (
            <li className="text-error">
              <strong className="font-mono">{summary.errors.length}</strong>{" "}
              insert error{summary.errors.length === 1 ? "" : "s"}
            </li>
          )}
        </ul>

        {summary.skippedReasons.length > 0 && (
          <details className="rounded-lg border border-edge bg-surface p-3 text-caption">
            <summary className="cursor-pointer text-content-secondary">
              Skipped rows ({summary.skippedReasons.length})
            </summary>
            <ul className="mt-2 space-y-1 font-mono text-content-muted">
              {summary.skippedReasons.slice(0, 50).map((r) => (
                <li key={r.rowNumber}>
                  Row {r.rowNumber}: {r.reason}
                </li>
              ))}
              {summary.skippedReasons.length > 50 && (
                <li className="italic">
                  …and {summary.skippedReasons.length - 50} more.
                </li>
              )}
            </ul>
          </details>
        )}

        <div className="rounded-lg border border-warning/40 bg-warning-soft/20 p-3 text-caption text-content-secondary">
          <AlertTriangle
            size={14}
            className="inline mr-1 text-warning align-text-bottom"
          />
          <strong className="text-warning">All imported rows are in
          category &quot;Other.&quot;</strong>{" "}
          The CSV doesn&apos;t carry categories — open Business →
          Expenses and recategorize before running tax reports.
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setSummary(null);
              setCsvText("");
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className={buttonSecondaryClass}
          >
            Import another CSV
          </button>
        </div>
      </section>
    );
  }

  const previewSampleRows = parsePreview?.rows.slice(0, 3) ?? [];
  const hasParsedRows = (parsePreview?.rows.length ?? 0) > 0;
  const showHeaderError =
    parsePreview &&
    parsePreview.rows.length === 0 &&
    parsePreview.skipped.length === 1 &&
    parsePreview.skipped[0]?.rowNumber === 0;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!hasParsedRows) return;
        setError(null);
        setCommitting(true);
        try {
          const fd = new FormData();
          fd.set("team_id", selectedTeamId);
          fd.set("csv", csvText);
          const result = await importExpensesCsvAction(fd);
          if (result.success) {
            setSummary(result.summary);
          } else {
            setError(result.error.userMessageKey);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setCommitting(false);
        }
      }}
      className="rounded-lg border border-edge bg-surface-raised p-4 mt-6 space-y-4"
    >
      <header className="flex items-center gap-2">
        <Receipt size={16} className="text-accent" />
        <h2 className="text-body-lg font-semibold text-content">
          Import expenses from CSV
        </h2>
      </header>

      <p className="text-caption text-content-muted max-w-2xl">
        Paste rows from your historical expense spreadsheet, or upload
        a CSV. Required headers: <code>Date</code> and{" "}
        <code>Amount</code> (case-insensitive). Optional:{" "}
        <code>Item</code> (vendor + description) and{" "}
        <code>Comments</code> (notes — invoice numbers, order numbers).
        All rows land in category{" "}
        <strong className="text-content">Other</strong> — categorize on
        the Expenses page after import.
      </p>

      {writableTeams.length > 1 && (
        <div>
          <label className={labelClass} htmlFor="expense-import-team">
            Team
          </label>
          <select
            id="expense-import-team"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className={selectClass}
            style={{ maxWidth: 320 }}
          >
            {writableTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="expense-import-csv">
          CSV
        </label>
        <textarea
          id="expense-import-csv"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={10}
          placeholder={`Date,Amount,Item,Comments
9/28/2018,$60.00,Domain - malcom.io: 1 year renewal,
1/1/2019,$10.00,Linode - server,Invoice #12045531`}
          className={`${textareaClass} font-mono text-caption`}
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              setCsvText(text);
            }}
            className="text-caption text-content-muted"
          />
          <span className="text-caption text-content-muted">
            <Upload size={12} className="inline mr-1 align-text-bottom" />
            Or drop a .csv file
          </span>
        </div>
      </div>

      {showHeaderError && (
        <div className="rounded-lg border border-error/40 bg-error-soft p-3 text-caption text-error">
          <AlertTriangle size={14} className="inline mr-1 align-text-bottom" />
          {parsePreview?.skipped[0]?.reason}
        </div>
      )}

      {hasParsedRows && (
        <div className="rounded-lg border border-edge-muted bg-surface p-3 space-y-2">
          <div className="flex items-center gap-2 text-caption text-content-secondary">
            <FileText size={12} />
            <span>
              <strong className="font-mono text-content">
                {parsePreview!.rows.length}
              </strong>{" "}
              row{parsePreview!.rows.length === 1 ? "" : "s"} ready to
              import
              {parsePreview!.skipped.length > 0 && (
                <>
                  {" · "}
                  <span className="text-warning">
                    {parsePreview!.skipped.length} skipped (parse errors)
                  </span>
                </>
              )}
            </span>
          </div>
          <table className="w-full text-caption">
            <thead>
              <tr className="border-b border-edge-muted text-content-muted">
                <th className="text-left py-1 pr-2 font-medium">Date</th>
                <th className="text-right py-1 px-2 font-medium">Amount</th>
                <th className="text-left py-1 px-2 font-medium">Vendor</th>
                <th className="text-left py-1 px-2 font-medium">
                  Description
                </th>
                <th className="text-left py-1 pl-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {previewSampleRows.map((row) => (
                <tr
                  key={row.import_source_id}
                  className="border-b border-edge-muted last:border-b-0"
                >
                  <td className="py-1 pr-2 font-mono">{row.incurred_on}</td>
                  <td className="py-1 px-2 font-mono text-right">
                    ${row.amount.toFixed(2)}
                  </td>
                  <td className="py-1 px-2">{row.vendor ?? "—"}</td>
                  <td className="py-1 px-2 truncate max-w-xs">
                    {row.description ?? "—"}
                  </td>
                  <td className="py-1 pl-2 truncate max-w-xs text-content-muted">
                    {row.notes ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {parsePreview!.rows.length > 3 && (
            <p className="text-caption text-content-muted italic">
              + {parsePreview!.rows.length - 3} more row
              {parsePreview!.rows.length - 3 === 1 ? "" : "s"}…
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-error/40 bg-error-soft p-3 text-caption text-error">
          <AlertTriangle size={14} className="inline mr-1 align-text-bottom" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!hasParsedRows || committing}
          className={buttonPrimaryClass}
        >
          {committing ? <Spinner size="h-3.5 w-3.5" /> : <Upload size={14} />}
          {committing
            ? "Importing…"
            : hasParsedRows
              ? `Import ${parsePreview!.rows.length} expense${parsePreview!.rows.length === 1 ? "" : "s"}`
              : "Import expenses"}
        </button>
        {csvText && !committing && (
          <button
            type="button"
            onClick={() => {
              setCsvText("");
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className={buttonSecondaryClass}
          >
            Clear
          </button>
        )}
      </div>
    </form>
  );
}
