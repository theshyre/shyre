"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, Spinner } from "@theshyre/ui";
import { Clock, History, Trash2, X } from "lucide-react";
import { buttonGhostClass } from "@/lib/form-styles";
import {
  getPersonHistoryAction,
  type PersonHistoryEntry,
} from "../../people-actions";

interface Props {
  open: boolean;
  onClose: () => void;
  personId: string;
  personDisplayName: string;
}

/** Human-readable labels for the fields we surface in the diff. The
 *  history JSONB carries every column on the row, but timestamps,
 *  internal ids, and the audit columns themselves don't help a
 *  reader understand what changed — those are filtered out below. */
const FIELD_LABELS: Record<string, string> = {
  legal_name: "Legal name",
  preferred_name: "Preferred name",
  work_email: "Work email",
  work_phone: "Work phone",
  employment_type: "Employment type",
  title: "Title",
  department: "Department",
  employee_number: "Employee number",
  started_on: "Started",
  ended_on: "Ended",
  compensation_type: "Compensation type",
  compensation_amount_cents: "Compensation amount (cents)",
  compensation_currency: "Compensation currency",
  compensation_schedule: "Compensation schedule",
  address_line1: "Address line 1",
  address_line2: "Address line 2",
  city: "City",
  state: "State",
  postal_code: "Postal code",
  country: "Country",
  reports_to_person_id: "Reports to",
  notes: "Notes",
  user_id: "Linked Shyre user",
  deleted_at: "Deleted at",
};

const HIDDEN_KEYS = new Set([
  "id",
  "business_id",
  "created_at",
  "updated_at",
  "created_by_user_id",
  "updated_by_user_id",
]);

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
    <Modal open={open} onClose={onClose} maxWidth="max-w-[640px]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
        <div className="flex items-center gap-2 min-w-0">
          <History size={18} className="text-accent shrink-0" />
          <h2 className="text-title font-semibold text-content truncate">
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

/** Render one history row. We diff `previous_state` against the
 *  *next-newer* entry's `previous_state` (or against the live row,
 *  represented by the most recent entry's snapshot taken from caller
 *  context — but we don't have that here, so the most recent entry
 *  shows its previous values without a comparison "to" side).
 *
 *  This is a deliberately simple diff — it lists every field whose
 *  value differs between this entry and the next newer one. Better
 *  than nothing, far less work than a real diff component. */
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

  // Compare this entry's previous_state to the *next newer* entry's
  // previous_state — the values diverged exactly during this change.
  // Without a "newer" reference (this is the most recent entry), we
  // just enumerate all the fields in the snapshot.
  const changedFields: Array<{
    key: string;
    label: string;
    from: unknown;
    to: unknown;
  }> = [];

  if (next === null) {
    // Most recent entry — we don't have a "to" side without the live
    // row. Show the previous values for editable fields only.
    for (const [key, value] of Object.entries(entry.previousState)) {
      if (HIDDEN_KEYS.has(key)) continue;
      const label = FIELD_LABELS[key];
      if (!label) continue;
      changedFields.push({ key, label, from: value, to: undefined });
    }
  } else {
    for (const key of Object.keys(FIELD_LABELS)) {
      const before = entry.previousState[key];
      const after = next.previousState[key];
      if (!isEqual(before, after)) {
        changedFields.push({
          key,
          label: FIELD_LABELS[key]!,
          from: before,
          to: after,
        });
      }
    }
  }

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

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
