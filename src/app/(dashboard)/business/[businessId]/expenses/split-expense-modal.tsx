"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Plus, Trash2, X, Wand2 } from "lucide-react";
import { AlertBanner, Spinner } from "@theshyre/ui";
import {
  inputClass,
  selectClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { splitExpenseAction } from "./actions";
import { EXPENSE_CATEGORIES } from "./categories";
import {
  appendBlankSplit,
  autoBalanceLastSplit,
  initialSplitState,
  removeSplitAt,
  summarizeSplitDiff,
  totalSplitCents,
  validateSplits,
  type ExpenseSplit,
} from "./split-helpers";

interface Props {
  expenseId: string;
  originalAmount: number;
  originalCurrency: string;
  originalCategory: string;
  originalNotes: string | null;
  onClose: () => void;
}

/**
 * Modal that splits one expense into N rows, one per category.
 * Modal (not inline) per CLAUDE.md popup rules: the form has
 * multi-row state + sum validation that benefits from the
 * focused, escape-dismissable surface a modal provides; inlining
 * inside a table cell crowds the spreadsheet.
 *
 * Save is disabled until validateSplits returns ok. Auto-balance
 * button absorbs rounding into the last split when the user is
 * close — saves the manual math on a 33.33 + 33.33 + 33.34 = 100
 * pattern.
 */
export function SplitExpenseModal({
  expenseId,
  originalAmount,
  originalCurrency,
  originalCategory,
  originalNotes,
  onClose,
}: Props): React.JSX.Element {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");

  // Initialize with two halves of the original (see
  // initialSplitState). splits[0] inherits the original's
  // category + notes; splits[1] starts as "other" with no
  // notes.
  const [splits, setSplits] = useState<ExpenseSplit[]>(() =>
    initialSplitState({
      originalAmount,
      originalCategory,
      originalNotes,
    }),
  );
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validation = useMemo(
    () => validateSplits(originalAmount, splits),
    [originalAmount, splits],
  );

  const totalCents = totalSplitCents(splits);
  const originalCents = Math.round(originalAmount * 100);
  const diff = summarizeSplitDiff(originalAmount, splits);
  const diffCents = diff.diffCents;

  // Escape closes (per modal rule). Also lock body scroll while
  // open so the table behind doesn't scroll under the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, submitting]);

  const update = (idx: number, patch: Partial<ExpenseSplit>): void => {
    setSplits((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };

  const addSplit = (): void => {
    setSplits((prev) => appendBlankSplit(prev));
  };

  const removeSplit = (idx: number): void => {
    setSplits((prev) => removeSplitAt(prev, idx));
  };

  const autoBalance = (): void => {
    const balanced = autoBalanceLastSplit(originalAmount, splits);
    if (balanced) setSplits(balanced);
  };

  async function handleSubmit(): Promise<void> {
    if (!validation.ok) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const fd = new FormData();
      fd.set("id", expenseId);
      fd.set("splits", JSON.stringify(splits));
      const result = await splitExpenseAction(fd);
      if (result && "success" in result && !result.success) {
        setServerError(result.error.userMessageKey);
        return;
      }
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const totalLabel = `${originalCurrency} ${(totalCents / 100).toFixed(2)}`;
  const originalLabel = `${originalCurrency} ${(originalCents / 100).toFixed(2)}`;
  const diffLabel = diff.label;

  // Render via portal into document.body so the modal isn't
  // pinned inside whatever HTML container it was invoked from
  // (a <td> in our case — putting position:fixed inside a table
  // cell trips edge cases on hydration + a11y announcement).
  if (typeof window === "undefined") return <></>;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-expense-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-content/40 p-4"
      onClick={(e) => {
        // Click on the backdrop closes; clicks inside the modal
        // panel bubble up here too, so we filter by target ===
        // currentTarget.
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-lg border border-edge bg-surface-raised p-5 shadow-lg"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2
              id="split-expense-title"
              className="text-title font-semibold text-content"
            >
              {t("split.title")}
            </h2>
            <p className="mt-1 text-caption text-content-muted">
              {t("split.subtitle", { amount: originalLabel })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label={tc("actions.cancel")}
            className="inline-flex items-center rounded-md p-1 text-content-muted hover:bg-hover hover:text-content"
          >
            <X size={16} />
          </button>
        </div>

        {serverError && (
          <AlertBanner tone="error">{serverError}</AlertBanner>
        )}

        <div className="space-y-2">
          {splits.map((s, i) => (
            <div
              key={i}
              className="grid gap-2 sm:grid-cols-[120px_180px_1fr_auto] items-start"
            >
              <div>
                {i === 0 && (
                  <label className={labelClass}>
                    {t("fields.amount")}
                  </label>
                )}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={Number.isFinite(s.amount) ? s.amount : ""}
                  onChange={(e) =>
                    update(i, { amount: Number(e.target.value) })
                  }
                  className={inputClass}
                  aria-label={`Split ${i + 1} amount`}
                />
                {validation.perSplit[i] && (
                  <p className="mt-1 text-caption text-error">
                    {validation.perSplit[i]}
                  </p>
                )}
              </div>
              <div>
                {i === 0 && (
                  <label className={labelClass}>
                    {t("fields.category")}
                  </label>
                )}
                <select
                  value={s.category}
                  onChange={(e) => update(i, { category: e.target.value })}
                  className={selectClass}
                  aria-label={`Split ${i + 1} category`}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                {i === 0 && (
                  <label className={labelClass}>
                    {t("fields.notes")}
                  </label>
                )}
                <input
                  type="text"
                  value={s.notes ?? ""}
                  onChange={(e) =>
                    update(i, { notes: e.target.value || null })
                  }
                  placeholder={t("split.notesPlaceholder")}
                  className={inputClass}
                  aria-label={`Split ${i + 1} notes`}
                />
              </div>
              <div className={i === 0 ? "pt-[26px]" : ""}>
                <button
                  type="button"
                  onClick={() => removeSplit(i)}
                  disabled={splits.length <= 2 || submitting}
                  aria-label={t("split.removeRow")}
                  className="inline-flex items-center rounded-md p-1.5 text-content-muted hover:bg-hover hover:text-error disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={addSplit}
            disabled={submitting}
            className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-raised px-2.5 py-1 text-caption font-medium text-content hover:bg-hover transition-colors"
          >
            <Plus size={12} />
            {t("split.addRow")}
          </button>
          <button
            type="button"
            onClick={autoBalance}
            disabled={submitting || diffCents === 0}
            className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-raised px-2.5 py-1 text-caption font-medium text-content hover:bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wand2 size={12} />
            {t("split.autoBalance")}
          </button>
        </div>

        <div className="mt-4 rounded-md border border-edge-muted bg-surface px-3 py-2 flex items-center justify-between">
          <div className="text-caption text-content-secondary">
            {t("split.totalLine", {
              total: totalLabel,
              original: originalLabel,
            })}
          </div>
          {diffLabel !== null && (
            <span
              className={`text-caption font-mono ${
                diff.isBalanced ? "text-success" : "text-warning"
              }`}
            >
              {diffLabel}
            </span>
          )}
        </div>

        {validation.summary && (
          <p className="mt-2 text-caption text-warning">
            {validation.summary}
          </p>
        )}

        <div className="mt-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={buttonSecondaryClass}
          >
            {tc("actions.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!validation.ok || submitting}
            className={buttonPrimaryClass}
          >
            {submitting ? <Spinner size="h-3.5 w-3.5" /> : null}
            {t("split.confirm", { count: splits.length })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
