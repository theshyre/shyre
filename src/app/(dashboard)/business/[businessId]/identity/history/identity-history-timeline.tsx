"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Briefcase,
  ChevronDown,
  Clock,
  FileBadge,
  Trash2,
} from "lucide-react";
import { Spinner } from "@theshyre/ui";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { getBusinessIdentityHistoryAction } from "../../../actions";
import {
  BUSINESS_FIELD_LABELS,
  REGISTRATION_FIELD_LABELS,
  IDENTITY_HISTORY_HIDDEN_KEYS,
  identityGroupKey,
  type IdentityHistoryEntry,
} from "../../../identity-history-types";
import {
  expandWithFieldDiffs,
  formatTimestamp,
  formatValue,
  type FieldChange,
} from "../../people/history/history-format";

const PAGE_SIZE = 200;

interface Props {
  businessId: string;
  entries: IdentityHistoryEntry[];
  hasMore: boolean;
}

/** Reverse-chronological merged timeline of `businesses_history` and
 *  `business_state_registrations_history` for one business. Each
 *  entry uses its kind's label map so the field names render
 *  correctly for whichever table the row came from. */
export function IdentityHistoryTimeline({
  businessId,
  entries: initialEntries,
  hasMore: initialHasMore,
}: Props): React.JSX.Element {
  const t = useTranslations("business.info.history");
  const [entries, setEntries] = useState(initialEntries);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Group by `kind:registrationId` so a business entry doesn't
  // accidentally diff against a registration entry, and
  // registrations for different states diff independently.
  const expanded = expandWithFieldDiffs({
    entries,
    groupKey: identityGroupKey,
    previousState: (e) => e.previousState,
    labels: (e) =>
      e.kind === "business"
        ? BUSINESS_FIELD_LABELS
        : REGISTRATION_FIELD_LABELS,
    hiddenKeys: IDENTITY_HISTORY_HIDDEN_KEYS,
  });
  const diffs = new Map<string, FieldChange[]>(
    expanded.map((x) => [x.entry.id, x.fields]),
  );

  async function loadMore(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await getBusinessIdentityHistoryAction(businessId, {
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
          <IdentityHistoryRow
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

function IdentityHistoryRow({
  entry,
  changedFields,
}: {
  entry: IdentityHistoryEntry;
  changedFields: FieldChange[];
}): React.JSX.Element {
  const t = useTranslations("business.info.history");
  const tPeople = useTranslations("business.people.history");
  const actor =
    entry.changedBy.displayName ??
    entry.changedBy.email ??
    tPeople("unknownActor");
  const when = formatTimestamp(entry.changedAt);
  const isDelete = entry.operation === "DELETE";
  const KindIcon = entry.kind === "business" ? Briefcase : FileBadge;

  return (
    <li className="rounded-md border border-edge bg-surface-raised p-3 space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <KindIcon size={14} className="text-accent shrink-0 self-center" />
        <span className="text-body-lg font-semibold text-content">
          {entry.rowLabel}
        </span>
        <span className="text-caption text-content-muted">
          {t(`kind.${entry.kind}`)}
        </span>
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
