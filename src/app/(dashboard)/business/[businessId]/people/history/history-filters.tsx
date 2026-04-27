"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Filter, X } from "lucide-react";
import {
  inputClass,
  selectClass,
  labelClass,
  buttonGhostClass,
  buttonPrimaryClass,
} from "@/lib/form-styles";

export interface FilterCandidates {
  people: { id: string; name: string }[];
  actors: { userId: string; name: string }[];
}

interface Props {
  businessId: string;
  currentFilters: {
    from: string | null;
    to: string | null;
    personId: string | null;
    actorUserId: string | null;
  };
  candidates: FilterCandidates;
}

/** Filter form for the people-history timeline. State lives in the
 *  URL — submit pushes a new query string and the server page
 *  re-renders with filtered data. Clear resets all four filters in
 *  one click. */
export function HistoryFilters({
  businessId,
  currentFilters,
  candidates,
}: Props): React.JSX.Element {
  const t = useTranslations("business.people.history");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [from, setFrom] = useState(currentFilters.from ?? "");
  const [to, setTo] = useState(currentFilters.to ?? "");
  const [personId, setPersonId] = useState(currentFilters.personId ?? "");
  const [actorUserId, setActorUserId] = useState(
    currentFilters.actorUserId ?? "",
  );

  const hasAnyFilter =
    !!currentFilters.from ||
    !!currentFilters.to ||
    !!currentFilters.personId ||
    !!currentFilters.actorUserId;

  function applyFilters(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    setOrDelete(params, "from", from);
    setOrDelete(params, "to", to);
    setOrDelete(params, "personId", personId);
    setOrDelete(params, "actorUserId", actorUserId);
    router.push(
      `/business/${businessId}/people/history` +
        (params.toString() ? `?${params.toString()}` : ""),
    );
  }

  function clearFilters(): void {
    setFrom("");
    setTo("");
    setPersonId("");
    setActorUserId("");
    router.push(`/business/${businessId}/people/history`);
  }

  return (
    <form
      onSubmit={applyFilters}
      className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-label font-semibold uppercase tracking-wider text-content-muted">
        <Filter size={12} />
        {t("filters.heading")}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={labelClass} htmlFor="hf-from">
            {t("filters.from")}
          </label>
          <input
            id="hf-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="hf-to">
            {t("filters.to")}
          </label>
          <input
            id="hf-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="hf-person">
            {t("filters.person")}
          </label>
          <select
            id="hf-person"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className={selectClass}
          >
            <option value="">{t("filters.anyPerson")}</option>
            {candidates.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="hf-actor">
            {t("filters.actor")}
          </label>
          <select
            id="hf-actor"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
            className={selectClass}
          >
            <option value="">{t("filters.anyActor")}</option>
            {candidates.actors.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className={buttonPrimaryClass}>
          {t("filters.apply")}
        </button>
        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className={`${buttonGhostClass} inline-flex items-center gap-1.5`}
          >
            <X size={12} />
            {t("filters.clear")}
          </button>
        )}
      </div>
    </form>
  );
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string,
): void {
  const trimmed = value.trim();
  if (trimmed) {
    params.set(key, trimmed);
  } else {
    params.delete(key);
  }
}
