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
import {
  computeFieldDiff,
  formatValue,
  formatTimestamp,
  type FieldChange,
} from "./history-format";

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
  // person (changes can arrive interleaved across people). Walking
  // in reverse order (oldest → newest) lets us track each person's
  // most-recent-seen-so-far and feed that as the "to" snapshot.
  const newerByPerson = new Map<string, BusinessPersonHistoryEntry>();
  const diffs = new Map<string, FieldChange[]>();
  for (const entry of [...entries].reverse()) {
    const newer = newerByPerson.get(entry.personId) ?? null;
    diffs.set(
      entry.id,
      computeFieldDiff(entry.previousState, newer?.previousState ?? null),
    );
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
  changedFields: FieldChange[];
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

