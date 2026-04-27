"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, Trash2, ChevronDown } from "lucide-react";
import { Spinner } from "@theshyre/ui";
import { buttonSecondaryClass } from "@/lib/form-styles";
import {
  getBusinessPeopleHistoryAction,
  type BusinessPersonHistoryEntry,
} from "../../../people-actions";

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

const PAGE_SIZE = 200;

interface Props {
  businessId: string;
  entries: BusinessPersonHistoryEntry[];
  hasMore: boolean;
}

/** Reverse-chronological list of every history entry across the
 *  business's people. The server fetches the first page; this
 *  component owns the "Load more" pager so a long-running shop with
 *  thousands of edits doesn't blow up the initial render. */
export function HistoryTimeline({
  businessId,
  entries: initialEntries,
  hasMore: initialHasMore,
}: Props): React.JSX.Element {
  const t = useTranslations("business.people.history");
  const [entries, setEntries] = useState(initialEntries);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Diff each entry against the *next-newer* entry for the same
  // person (since changes can arrive out of order across people).
  // Group history by personId so we can find each entry's
  // chronological neighbor.
  const newerByPerson = new Map<string, BusinessPersonHistoryEntry>();
  const diffs = new Map<
    string,
    Array<{ key: string; label: string; from: unknown; to: unknown | undefined }>
  >();
  // Walk in reverse order (oldest → newest) so for each entry we
  // know what came *before* it, and use that to compute "to" =
  // newer entry's previous_state.
  const orderedOldFirst = [...entries].reverse();
  for (const entry of orderedOldFirst) {
    const newer = newerByPerson.get(entry.personId);
    const fields: Array<{
      key: string;
      label: string;
      from: unknown;
      to: unknown | undefined;
    }> = [];
    if (newer === undefined) {
      // Most-recent for this person — show the previous values.
      for (const [key, value] of Object.entries(entry.previousState)) {
        if (HIDDEN_KEYS.has(key)) continue;
        const label = FIELD_LABELS[key];
        if (!label) continue;
        fields.push({ key, label, from: value, to: undefined });
      }
    } else {
      for (const key of Object.keys(FIELD_LABELS)) {
        const before = entry.previousState[key];
        const after = newer.previousState[key];
        if (!isEqual(before, after)) {
          fields.push({
            key,
            label: FIELD_LABELS[key]!,
            from: before,
            to: after,
          });
        }
      }
    }
    diffs.set(entry.id, fields);
    newerByPerson.set(entry.personId, entry);
  }

  async function loadMore(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await getBusinessPeopleHistoryAction(businessId, {
        limit: PAGE_SIZE,
        offset: entries.length,
      });
      setEntries((prev) => [...prev, ...res.history]);
      setHasMore(res.hasMore);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {entries.map((entry) => (
          <HistoryRow
            key={entry.id}
            entry={entry}
            changedFields={diffs.get(entry.id) ?? []}
          />
        ))}
      </ol>

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className={`${buttonSecondaryClass} inline-flex items-center gap-2`}
          >
            {loading ? <Spinner size="h-3 w-3" /> : <ChevronDown size={14} />}
            {t("loadMore")}
          </button>
        </div>
      )}

      {error && (
        <p className="text-caption text-error">
          {t("error", { message: error })}
        </p>
      )}
    </div>
  );
}

function HistoryRow({
  entry,
  changedFields,
}: {
  entry: BusinessPersonHistoryEntry;
  changedFields: Array<{
    key: string;
    label: string;
    from: unknown;
    to: unknown | undefined;
  }>;
}): React.JSX.Element {
  const t = useTranslations("business.people.history");
  const actor =
    entry.changedBy.displayName ?? entry.changedBy.email ?? t("unknownActor");
  const when = formatTimestamp(entry.changedAt);
  const isDelete = entry.operation === "DELETE";

  return (
    <li className="rounded-md border border-edge bg-surface-raised p-3 space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        {isDelete ? (
          <Trash2 size={14} className="text-error shrink-0 self-center" />
        ) : (
          <Clock size={14} className="text-accent shrink-0 self-center" />
        )}
        <span className="text-body-lg font-semibold text-content">
          {entry.personDisplayName}
        </span>
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
