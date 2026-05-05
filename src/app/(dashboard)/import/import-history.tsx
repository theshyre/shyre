"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  History,
  CheckCircle,
  XCircle,
  Undo2,
  Loader2,
  X,
} from "lucide-react";
import { InlineErrorCard } from "@/components/InlineErrorCard";
import {
  buttonDangerClass,
  buttonGhostClass,
  inputClass,
} from "@/lib/form-styles";
import { undoImportRunAction } from "./actions";
import {
  buildCountsList,
  canRenderUndo,
  effectiveStatusKind,
  sourceLabel,
} from "./history-display";

export interface ImportRunRow {
  id: string;
  team_id: string;
  imported_from: string;
  source_account_identifier: string | null;
  started_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "failed";
  summary:
    | {
        imported?: {
          customers?: number;
          projects?: number;
          timeEntries?: number;
          expenses?: number;
        };
        skipped?: {
          timeEntries?: number;
          reasons?: Record<string, number>;
        };
        errors?: string[];
      }
    | null;
  undone_at: string | null;
  triggered_by_display_name: string | null;
  undone_by_display_name: string | null;
  /** Date range covered by the imported time entries (start_time
   *  min / max). Computed in the page fetch from time_entries
   *  filtered to this import_run_id, so old runs benefit too — no
   *  schema migration needed. NULL when the run had no time
   *  entries OR when the run was undone (the entries are gone). */
  entries_earliest_start: string | null;
  entries_latest_start: string | null;
}

interface Props {
  runs: ImportRunRow[];
  /** Team IDs where the caller has owner/admin role; the Undo button
   * only renders for runs whose team_id is in this list. The server
   * action re-checks, but gating the UI per-run avoids showing a
   * button that would definitely 403 on click. */
  adminTeamIds: string[];
}

export function ImportHistory({
  runs,
  adminTeamIds,
}: Props): React.JSX.Element {
  const t = useTranslations("import.history");
  const adminSet = new Set(adminTeamIds);

  if (runs.length === 0) {
    return (
      <section className="mt-6 rounded-lg border border-edge bg-surface-raised p-6">
        <SectionHeader />
        <p className="mt-2 text-body text-content-muted italic">
          {t("empty")}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-edge bg-surface-raised p-6">
      <SectionHeader />
      <p className="mt-2 text-body text-content-secondary max-w-3xl">
        {t("description")}
      </p>

      <ul className="mt-4 divide-y divide-edge-muted border-t border-edge-muted">
        {runs.map((run) => (
          <li key={run.id} className="py-3">
            <RunRow run={run} canUndo={adminSet.has(run.team_id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionHeader(): React.JSX.Element {
  const t = useTranslations("import.history");
  return (
    <div className="flex items-center gap-3">
      <History size={20} className="text-accent shrink-0" />
      <h2 className="text-title font-semibold text-content">{t("title")}</h2>
    </div>
  );
}

function RunRow({
  run,
  canUndo,
}: {
  run: ImportRunRow;
  canUndo: boolean;
}): React.JSX.Element {
  const t = useTranslations("import.history");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // True when the last failure was a refusal the user can force
  // through (manual entries on imported projects, manual projects
  // on imported customers). The "Undo anyway" follow-up only renders
  // when this is true — refusals that protect against FK errors
  // (orphan invoices) cannot be forced and stay surfaced as a
  // hard block.
  const [forceable, setForceable] = useState(false);

  // Run the undo action; can be called twice (first attempt + forced
  // retry). Server-side errors return { success: false, error } —
  // we read the result and throw on failure so the catch handler
  // surfaces the message inline.
  //
  // forceable state lifecycle: only changed by the catch handler
  // (set true on a manual-data refusal) or on success (cleared so
  // the card unmounts). We deliberately do NOT clear forceable at
  // the start of runUndo, which would unmount the ForceUndoConfirm
  // card the moment the user clicks Undo Anyway and leave them
  // staring at a blank space while the request is in flight.
  async function runUndo(force: boolean): Promise<void> {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("run_id", run.id);
    fd.set("team_id", run.team_id);
    if (force) fd.set("force", "true");
    try {
      const result = (await undoImportRunAction(fd)) as unknown as
        | {
            success: boolean;
            error?: { message?: string; userMessageKey?: string };
          }
        | void;
      if (
        result &&
        (result as { success: boolean }).success === false
      ) {
        const err = (
          result as {
            error?: { message?: string; userMessageKey?: string };
          }
        ).error;
        throw new Error(
          err?.message ?? err?.userMessageKey ?? "Undo failed",
        );
      }
      // Success — clear all surfaced refusal state so the row
      // re-renders cleanly with `undone_at` set.
      setForceable(false);
      setConfirming(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Undo failed";
      setError(message);
      // Detect "manual data" refusals — only those are safe to force.
      // Refusals #1 / #2 (invoices) would crash with FK errors mid-
      // transaction even with force=true, so we never offer the
      // bypass on those.
      setForceable(/manual (time entry|time entries|project|projects)/i.test(message));
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  const counts = buildCountsList(run.summary, {
    customer: (n) => t("counts.customers", { count: n }),
    project: (n) => t("counts.projects", { count: n }),
    timeEntry: (n) => t("counts.timeEntries", { count: n }),
    expense: (n) => t("counts.expenses", { count: n }),
  });

  const source = sourceLabel(run);
  const shouldShowUndo = canRenderUndo(
    { undone_at: run.undone_at, status: run.status },
    canUndo,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3 flex-wrap">
        <StatusBadge status={run.status} undone={run.undone_at !== null} />

        <div className="flex-1 min-w-[220px] space-y-0.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-content">{source}</span>
            <span className="text-caption text-content-muted">
              {formatDateTime(run.started_at)}
            </span>
            {run.triggered_by_display_name ? (
              <span className="text-caption text-content-muted">
                · by {run.triggered_by_display_name}
              </span>
            ) : null}
          </div>

          {counts.length > 0 ? (
            <div className="text-caption text-content-secondary">
              {counts.join(" · ")}
            </div>
          ) : null}

          {run.entries_earliest_start && run.entries_latest_start ? (
            // Date range covered by the imported time entries —
            // helps the user identify which historical period each
            // Harvest pull picked up. Hidden when there are no
            // entries (e.g. a customers-only import) or when the
            // run has been undone (the entries are gone).
            <div className="text-caption text-content-secondary">
              {t("coversDates", {
                earliest: formatDateOnly(run.entries_earliest_start),
                latest: formatDateOnly(run.entries_latest_start),
              })}
            </div>
          ) : null}

          {run.undone_at ? (
            <div className="text-caption text-content-muted italic">
              {t("undoneAt", { date: formatDateTime(run.undone_at) })}
              {run.undone_by_display_name
                ? ` · ${t("undoneBy", { name: run.undone_by_display_name })}`
                : ""}
            </div>
          ) : null}

          {run.status === "failed" && run.summary?.errors?.length ? (
            <div className="text-caption text-error">
              {run.summary.errors[0]}
            </div>
          ) : null}

          <div className="text-caption text-content-muted font-mono">
            {run.id}
          </div>
        </div>

        {shouldShowUndo && !confirming ? (
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
            }}
            className={`${buttonGhostClass} inline-flex items-center gap-1 text-error-text hover:bg-error-soft`}
            aria-label={t("undoButton")}
          >
            <Undo2 size={14} />
            {t("undoButton")}
          </button>
        ) : null}

        {confirming ? (
          <UndoConfirmInline
            pending={pending}
            onCancel={() => {
              setConfirming(false);
              setError(null);
            }}
            onConfirm={async () => {
              await runUndo(false);
            }}
          />
        ) : null}
      </div>

      {error ? (
        <div className="space-y-2">
          <InlineErrorCard title={error} />
          {forceable && shouldShowUndo ? (
            <ForceUndoConfirm
              pending={pending}
              onCancel={() => {
                setError(null);
                setForceable(false);
              }}
              onConfirm={async () => {
                await runUndo(true);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Two-step opt-in for the force-undo path. The user has already
 * read the refusal explanation in the InlineErrorCard above; this
 * card adds a typed-confirm to arm "delete the manual data anyway."
 * Same pattern as VoidButton's typed-confirm — type "delete" to
 * arm. Single-word keyword (not the run id) because the user is
 * already past the first opt-in by clicking Undo.
 */
function ForceUndoConfirm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}): React.JSX.Element {
  const t = useTranslations("import.history");
  const [typed, setTyped] = useState("");
  const armed = typed.trim().toLowerCase() === "delete";
  return (
    <div className="rounded-md border border-warning/40 bg-warning-soft/30 p-2.5 space-y-2">
      <p className="text-caption text-content-secondary">
        {t("forceUndoExplain")}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-caption text-content-muted">
          {t("forceUndoPrompt")}
        </span>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && armed && !pending) {
              e.preventDefault();
              void onConfirm();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label={t("forceUndoInputLabel")}
          disabled={pending}
          className="rounded-md border border-edge bg-surface px-2 py-1 text-caption font-mono w-24 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={!armed || pending}
          aria-busy={pending}
          className="inline-flex items-center gap-1.5 rounded bg-error px-2 py-1 text-caption font-semibold text-content-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {pending && (
            <Loader2
              size={12}
              className="animate-spin"
              aria-hidden="true"
            />
          )}
          {pending ? t("forceUndoPending") : t("forceUndoConfirm")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded p-1 text-content-muted hover:bg-hover transition-colors text-caption disabled:opacity-50"
        >
          {t("forceUndoCancel")}
        </button>
      </div>
    </div>
  );
}

/**
 * Inline undo-confirm that replaces the Undo button in place on the
 * same row. Single visual unit: prompt → input → armed Undo button
 → Cancel (x), keeping the click target exactly where the user first
 * clicked.
 *
 * Armed only when the typed value matches the translated confirm
 * word case-insensitively. Enter submits when armed, Escape cancels
 * at any time.
 *
 * This is purpose-built for undo rather than reusing the delete-
 * semantic InlineDeleteRowConfirm — that primitive hard-wires the
 * word "delete" and button label "Delete" via its locale bundle,
 * which was wrong for an undo action.
 */
function UndoConfirmInline({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const t = useTranslations("import.history");
  const [value, setValue] = useState("");
  const confirmWord = t("confirm.word");
  const armed =
    value.trim().toLowerCase() === confirmWord.trim().toLowerCase();

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <span className="text-caption text-content-secondary">
        {t("confirm.prompt")}
      </span>
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && armed && !pending) {
            e.preventDefault();
            onConfirm();
          }
        }}
        disabled={pending}
        aria-label={t("confirm.inputAriaLabel")}
        className={`${inputClass} text-caption font-mono`}
        style={{ width: 100, padding: "2px 8px", height: 28 }}
      />
      <button
        type="button"
        onClick={onConfirm}
        disabled={!armed || pending}
        className={`${buttonDangerClass} inline-flex items-center gap-1 text-caption`}
        style={{ padding: "2px 10px", height: 28 }}
      >
        <Undo2 size={12} />
        {pending ? t("undoing") : t("undoButton")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className={buttonGhostClass}
        aria-label={t("confirm.cancel")}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function StatusBadge({
  status,
  undone,
}: {
  status: ImportRunRow["status"];
  undone: boolean;
}): React.JSX.Element {
  const t = useTranslations("import.history");
  const kind = effectiveStatusKind({
    status,
    undone_at: undone ? "x" : null,
  });

  if (kind === "undone") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-inset px-2 py-0.5 text-caption font-medium text-content-muted">
        <Undo2 size={10} />
        {t("statuses.undone")}
      </span>
    );
  }
  if (kind === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-caption font-medium text-success-text">
        <CheckCircle size={10} />
        {t("statuses.completed")}
      </span>
    );
  }
  if (kind === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-error-soft px-2 py-0.5 text-caption font-medium text-error-text">
        <XCircle size={10} />
        {t("statuses.failed")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-caption font-medium text-accent-text">
      {t("statuses.running")}
    </span>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Date-only locale format for the import-period range (no clock,
 *  since the user thinks in calendar days when scoping a Harvest
 *  pull). Year omitted only when it matches the current year. */
function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  });
}
