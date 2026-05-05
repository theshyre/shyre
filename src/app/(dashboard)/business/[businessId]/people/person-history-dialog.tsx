"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Spinner } from "@theshyre/ui";
import { Modal } from "@/components/Modal";
import { Clock, History, Trash2, X } from "lucide-react";
import { buttonGhostClass } from "@/lib/form-styles";
import {
  getPersonHistoryAction,
  type PersonHistoryEntry,
} from "../../people-actions";
import {
  computeFieldDiff,
  formatValue,
  formatTimestamp,
  type FieldChange,
} from "./history/history-format";

interface Props {
  open: boolean;
  onClose: () => void;
  personId: string;
  personDisplayName: string;
}

export function PersonHistoryDialog({
  open,
  onClose,
  personId,
  personDisplayName,
}: Props): React.JSX.Element {
  const t = useTranslations("business.people.history");
  const [history, setHistory] = useState<PersonHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch in an async callback so the state-setters land outside the
  // effect body — `react-hooks/set-state-in-effect` flags synchronous
  // setState in effects, async-inside-callback is fine. Pattern
  // matches `<GitHubIssuePicker>`'s fetch-on-trigger.
  const fetchHistory = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await getPersonHistoryAction(id);
      setHistory(res.history);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchHistory(personId);
  }, [open, personId, fetchHistory]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-[640px]"
      titleId="person-history-dialog-title"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
        <div className="flex items-center gap-2 min-w-0">
          <History size={18} className="text-accent shrink-0" />
          <h2
            id="person-history-dialog-title"
            className="text-title font-semibold text-content truncate"
          >
            {t("title", { name: personDisplayName })}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`${buttonGhostClass} shrink-0`}
          aria-label={t("close")}
        >
          <X size={16} />
        </button>
      </div>

      <div className="max-h-[480px] overflow-y-auto px-5 py-4">
        {loading && (
          <div className="flex items-center gap-2 text-body text-content-muted">
            <Spinner size="h-4 w-4" />
            {t("loading")}
          </div>
        )}
        {error && !loading && (
          <p className="text-body text-error">{t("error", { message: error })}</p>
        )}
        {!loading && !error && history && history.length === 0 && (
          <p className="text-body text-content-muted italic">{t("empty")}</p>
        )}
        {!loading && !error && history && history.length > 0 && (
          <ol className="space-y-3">
            {history.map((entry, idx) => (
              <HistoryEntryItem
                key={entry.id}
                entry={entry}
                next={history[idx - 1] ?? null}
              />
            ))}
            <li className="text-caption text-content-muted italic pt-2 border-t border-edge-muted">
              {t("createdNote")}
            </li>
          </ol>
        )}
      </div>
    </Modal>
  );
}

function HistoryEntryItem({
  entry,
  next,
}: {
  entry: PersonHistoryEntry;
  next: PersonHistoryEntry | null;
}): React.JSX.Element {
  const t = useTranslations("business.people.history");
  const actor =
    entry.changedBy.displayName ?? entry.changedBy.email ?? t("unknownActor");
  const when = formatTimestamp(entry.changedAt);
  const isDelete = entry.operation === "DELETE";

  const changedFields: FieldChange[] = computeFieldDiff(
    entry.previousState,
    next?.previousState ?? null,
  );

  return (
    <li className="rounded-md border border-edge bg-surface p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {isDelete ? (
          <Trash2 size={14} className="text-error shrink-0" />
        ) : (
          <Clock size={14} className="text-accent shrink-0" />
        )}
        <span
          className={`text-label font-semibold uppercase tracking-wider ${
            isDelete ? "text-error" : "text-content-secondary"
          }`}
        >
          {t(`operation.${entry.operation}`)}
        </span>
        <span className="text-caption text-content-muted">
          {t("byOn", { actor, when })}
        </span>
      </div>
      {changedFields.length === 0 ? (
        <p className="text-caption text-content-muted italic">
          {t("noFieldChanges")}
        </p>
      ) : (
        <dl className="space-y-1 text-caption">
          {changedFields.map((field) => (
            <div key={field.key} className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-content-muted shrink-0">{field.label}:</dt>
              <dd className="text-content-secondary">
                {field.to !== undefined ? (
                  <>
                    <span className="line-through text-content-muted">
                      {formatValue(field.from)}
                    </span>
                    <span className="mx-1 text-content-muted">→</span>
                    <span className="text-content">
                      {formatValue(field.to)}
                    </span>
                  </>
                ) : (
                  <span>{formatValue(field.from)}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}
