"use client";

import { useCallback, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Calendar, Plus, ChevronDown } from "lucide-react";
import {
  formatDurationHM,
  formatDurationHMZero,
  sumBillableMin,
  sumDurationMin,
} from "@/lib/time/week";
import { addLocalDays } from "@/lib/time/tz";
import { buttonSecondaryClass } from "@/lib/form-styles";
import { EntryTable } from "./entry-table";
import { JumpToDate } from "./jump-to-date";
import { groupEntriesByCustomer } from "./customer-grouping";
import type { CategoryOption, ProjectOption, TimeEntry } from "./types";

interface DayBand {
  /** Local YYYY-MM-DD identifier. */
  key: string;
  /** Entries falling on this band's day, chronological asc. */
  entries: TimeEntry[];
}

interface Props {
  /** Newest day in the visible window (YYYY-MM-DD, user TZ). */
  anchorStr: string;
  /** Local "today" in user TZ. Drives the Today marker + band styling. */
  todayStr: string;
  /** Window size in days. Bands rendered: anchor, anchor-1, …,
   *  anchor - (windowDays - 1). */
  windowDays: number;
  /** Default window — used to render the "Reset" affordance label. */
  defaultWindowDays: number;
  /** Cap on how far the window can grow on a single click. UI clamps
   *  to it; if reached, the Load earlier button disables. */
  maxWindowDays: number;
  tzOffsetMin: number;
  /** All visible entries pre-fetched server-side. The component
   *  buckets them into bands client-side. */
  entries: TimeEntry[];
  projects: ProjectOption[];
  categories: CategoryOption[];
  viewerUserId: string;
}

/**
 * Unified Time view — preview.
 *
 * Date-banded vertical scroll: anchor at top, older days flowing
 * down. Each band carries the day's totals and a list of entries
 * (reusing EntryTable for row rendering, so authorship + edit
 * affordances stay byte-identical with day/week views). Empty
 * bands render as a thin "Add entry" placeholder so the calendar
 * rhythm is preserved.
 *
 * Preview cuts (versus the full design at
 * `docs/reference/unified-time.md`):
 *   - No swim-lane mode for `members != me`. Multi-author renders
 *     chronologically with author chip per row.
 *   - No jump-to-date popover. URL accepts `?anchor=YYYY-MM-DD`,
 *     and the bottom "Load earlier" button bumps the window by
 *     7 days at a time.
 *   - No per-band sticky lock strip. The existing top-of-page
 *     "Locked through" banner remains. Locked rows still have
 *     edit affordances absent (EntryRow already handles).
 *   - No virtualization. Default window is 14 days, hard ceiling
 *     90 — bounded enough that a single render is fine.
 *   - No print stylesheet, no keyboard model beyond view-toggle.
 *
 * The component is a `"use client"` so the Load-earlier button can
 * call `router.push` without server round-trips. The fetch happens
 * server-side in page.tsx and is passed down as props.
 */
export function LogView({
  anchorStr,
  todayStr,
  windowDays,
  defaultWindowDays,
  maxWindowDays,
  tzOffsetMin,
  entries,
  projects,
  categories,
  viewerUserId,
}: Props): React.JSX.Element {
  const t = useTranslations("time.log");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedEntryId((cur) => (cur === id ? null : id));
  }, []);

  // Build band list anchor → anchor-(window-1). One band per day so
  // empty days render — collapsing zero-days hides "did I forget
  // yesterday?" signal, which is the entire pitch of the Log view.
  const bands: DayBand[] = [];
  for (let i = 0; i < windowDays; i++) {
    const key = addLocalDays(anchorStr, -i);
    bands.push({ key, entries: [] });
  }
  const bandByKey = new Map(bands.map((b) => [b.key, b]));

  // Bucket entries into their start-day band (start-day attribution
  // matches the design doc's cross-midnight rule + Week-grid
  // behavior — bookkeepers see the same totals everywhere).
  for (const e of entries) {
    const localKey = formatStartDayLocal(e.start_time, tzOffsetMin);
    const band = bandByKey.get(localKey);
    if (band) band.entries.push(e);
  }
  for (const band of bands) {
    band.entries.sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
  }

  function loadEarlier(): void {
    const next = Math.min(windowDays + 7, maxWindowDays);
    if (next === windowDays) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("windowDays", String(next));
    router.push(`${pathname}?${params.toString()}`);
  }

  function resetWindow(): void {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("windowDays");
    router.push(`${pathname}?${params.toString()}`);
  }

  const atCeiling = windowDays >= maxWindowDays;
  const expanded = windowDays > defaultWindowDays;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <JumpToDate
          view="log"
          anchorStr={anchorStr}
          todayStr={todayStr}
          tzOffsetMin={tzOffsetMin}
        />
        <p className="text-caption text-content-muted italic ml-auto">
          {t("preview")}
        </p>
      </div>
      {bands.map((band) => (
        <BandSection
          key={band.key}
          band={band}
          isToday={band.key === todayStr}
          tzOffsetMin={tzOffsetMin}
          projects={projects}
          categories={categories}
          expandedEntryId={expandedEntryId}
          onToggleExpand={toggleExpanded}
          viewerUserId={viewerUserId}
          tEmpty={t("emptyDay")}
          tToday={t("todayMarker")}
        />
      ))}
      <div className="flex items-center justify-between gap-2 pt-3">
        <button
          type="button"
          onClick={loadEarlier}
          disabled={atCeiling}
          className={buttonSecondaryClass}
          aria-label={atCeiling ? t("loadEarlierCeiling") : t("loadEarlier")}
        >
          <ChevronDown size={14} />
          {atCeiling ? t("loadEarlierCeiling") : t("loadEarlier")}
        </button>
        {expanded && (
          <button
            type="button"
            onClick={resetWindow}
            className="text-caption text-content-muted hover:text-content"
          >
            {t("reset", { days: defaultWindowDays })}
          </button>
        )}
      </div>
    </div>
  );
}

function BandSection({
  band,
  isToday,
  tzOffsetMin,
  projects,
  categories,
  expandedEntryId,
  onToggleExpand,
  viewerUserId,
  tEmpty,
  tToday,
}: {
  band: DayBand;
  isToday: boolean;
  tzOffsetMin: number;
  projects: ProjectOption[];
  categories: CategoryOption[];
  expandedEntryId: string | null;
  onToggleExpand: (id: string) => void;
  viewerUserId: string;
  tEmpty: string;
  tToday: string;
}): React.JSX.Element {
  const tTimesheet = useTranslations("time.timesheet.customerSubgroup");
  const customerGroups = groupEntriesByCustomer(band.entries, projects, {
    internal: tTimesheet("internal"),
    noCustomer: tTimesheet("noCustomer"),
  });
  const totalMin = sumDurationMin(band.entries);
  const billableMin = sumBillableMin(band.entries);
  const headingId = `log-day-${band.key}`;
  const isWeekend = isLocalWeekend(band.key);
  const isEmpty = band.entries.length === 0;

  // Headings are sticky so the user can always tell which day they're
  // looking at while they scroll. Today gets a colored accent + Today
  // word + calendar icon — three channels per the redundant-encoding
  // rule. Weekend uses an inset bg + the day name (Saturday / Sunday)
  // so it's not color-only.
  return (
    <section
      aria-labelledby={headingId}
      className={
        isToday
          ? "rounded-md border border-accent/40 bg-surface-raised"
          : isWeekend
            ? "rounded-md border border-edge bg-surface-inset"
            : "rounded-md border border-edge bg-surface-raised"
      }
    >
      <h2
        id={headingId}
        aria-current={isToday ? "date" : undefined}
        className={`sticky top-0 z-10 flex items-center gap-3 px-3 py-2 rounded-t-md backdrop-blur ${
          isToday
            ? "bg-accent-soft/70 text-content"
            : isWeekend
              ? "bg-surface-inset/80 text-content-secondary"
              : "bg-surface-raised/80 text-content-secondary"
        }`}
      >
        {isToday && (
          <Calendar size={14} className="text-accent" aria-hidden />
        )}
        <span className="text-body font-semibold">
          {formatBandLabel(band.key)}
        </span>
        {isToday && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-caption font-medium text-accent">
            {tToday}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          {!isEmpty && (
            <>
              <span className="font-mono text-caption tabular-nums text-content">
                {formatDurationHMZero(totalMin)}
              </span>
              <span className="font-mono text-caption tabular-nums text-content-muted">
                {formatDurationHM(billableMin)} billable
              </span>
            </>
          )}
        </span>
      </h2>
      {isEmpty ? (
        <div className="px-3 pb-3 pt-1 text-caption text-content-muted italic flex items-center gap-2">
          <Plus size={12} aria-hidden />
          {tEmpty}
        </div>
      ) : (
        <div className="px-3 pb-3 pt-1">
          {/* Customer sub-grouped EntryTable — mirrors the Day view's
              layout so a user scanning the Log sees one customer
              cluster per (day × customer) pair, with the hashed rail
              tying same-customer rows together. Part of the time-
              views parity rule (memory: feedback_time_views_parity). */}
          <EntryTable
            groups={customerGroups}
            projects={projects}
            categories={categories}
            expandedEntryId={expandedEntryId}
            onToggleExpand={onToggleExpand}
            tzOffsetMin={tzOffsetMin}
            viewerUserId={viewerUserId}
          />
        </div>
      )}
    </section>
  );
}

/** ISO start_time → local YYYY-MM-DD using the user's tz offset.
 *  Matches the bucketing used elsewhere in the app so the same
 *  entry is in the same band the Week grid puts it in. */
function formatStartDayLocal(
  startIso: string,
  tzOffsetMin: number,
): string {
  // tzOffsetMin is "minutes west of UTC", so local = UTC − offset.
  const utcMs = new Date(startIso).getTime();
  const localMs = utcMs - tzOffsetMin * 60_000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD → "Wed Apr 29". toLocaleDateString-driven so locale
 *  flips automatically once we wire next-intl's formatter into the
 *  scope. Today's marker is added by the caller. */
function formatBandLabel(key: string): string {
  // Construct as UTC midnight so the locale formatter doesn't
  // shift the day across timezones.
  const [y, m, d] = key.split("-").map((s) => parseInt(s, 10));
  const date = new Date(Date.UTC(y!, (m! - 1), d!));
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Saturday or Sunday in UTC (the band keys are tz-naive YYYY-MM-DD,
 *  so this checks the calendar day, not a wall-clock instant). */
function isLocalWeekend(key: string): boolean {
  const [y, m, d] = key.split("-").map((s) => parseInt(s, 10));
  const date = new Date(Date.UTC(y!, (m! - 1), d!));
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}
