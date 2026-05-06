"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Clock, Trash2 } from "lucide-react";
import { Spinner } from "@theshyre/ui";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { getProjectHistoryAction } from "../../actions";
import {
  PROJECT_FIELD_LABELS,
  PROJECT_HISTORY_HIDDEN_KEYS,
  type ProjectHistoryEntry,
} from "./project-history-types";
import {
  expandWithFieldDiffs,
  formatTimestamp,
  formatValue,
  type FieldChange,
} from "../../../business/[businessId]/people/history/history-format";

const PAGE_SIZE = 200;

interface Props {
  projectId: string;
  entries: ProjectHistoryEntry[];
  hasMore: boolean;
}

/** Reverse-chronological timeline of `projects_history`. Each entry
 *  shows the field-level diff against the next-newer entry for the
 *  same project; the most-recent entry shows the previous values
 *  enumerated. Reuses the people/identity history formatting helpers
 *  so diff semantics stay consistent across audit surfaces. */
export function ProjectHistoryTimeline({
  projectId,
  entries: initialEntries,
  hasMore: initialHasMore,
}: Props): React.JSX.Element {
  const t = useTranslations("projects.history");
  const tPeople = useTranslations("business.people.history");
  const [entries, setEntries] = useState(initialEntries);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single-group: every row diffs against the next-newer row for
  // the SAME project. Constant key works because this page only
  // shows one project's history.
  const expanded = expandWithFieldDiffs({
    entries,
    groupKey: () => projectId,
    previousState: (e) => e.previousState,
    labels: () => PROJECT_FIELD_LABELS,
    hiddenKeys: PROJECT_HISTORY_HIDDEN_KEYS,
  });
  const diffs = new Map<string, FieldChange[]>(
    expanded.map((x) => [x.entry.id, x.fields]),
  );

  async function loadMore(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectHistoryAction(projectId, {
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
          <ProjectHistoryRow
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
          {tPeople("error", { message: error })}
        </p>
      )}
    </div>
  );
}

function ProjectHistoryRow({
  entry,
  changedFields,
}: {
  entry: ProjectHistoryEntry;
  changedFields: FieldChange[];
}): React.JSX.Element {
  const tPeople = useTranslations("business.people.history");
  const actor =
    entry.changedBy.displayName ?? tPeople("unknownActor");
  const when = formatTimestamp(entry.changedAt);
  const isDelete = entry.operation === "DELETE";

  return (
    <li className="rounded-md border border-edge bg-surface-raised p-3 space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        {isDelete ? (
          <Trash2 size={14} className="text-error shrink-0 self-center" />
        ) : (
          <Clock size={14} className="text-content-muted shrink-0 self-center" />
        )}
        <span
          className={`text-label font-semibold uppercase tracking-wider ${
            isDelete ? "text-error" : "text-content-secondary"
          }`}
        >
          {tPeople(`operation.${entry.operation}`)}
        </span>
        <span className="text-caption text-content-muted">
          {tPeople("byOn", { actor, when })}
        </span>
      </div>
      {changedFields.length === 0 ? (
        <p className="text-caption text-content-muted italic">
          {tPeople("noFieldChanges")}
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
