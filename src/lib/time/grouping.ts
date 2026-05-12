/**
 * Grouping helpers for time entries — buckets entries by a chosen dimension
 * (day / category / project / client) with per-group totals.
 */

import { isSameDay, sumBillableMin, sumDurationMin } from "./week";

export type GroupingKind = "day" | "category" | "project";
export const ALL_GROUPINGS: GroupingKind[] = ["day", "category", "project"];

export interface GroupableEntry {
  id: string;
  start_time: string;
  end_time: string | null;
  duration_min: number | null;
  billable: boolean;
  project_id: string;
  category_id: string | null;
}

export interface EntryGroup<T extends GroupableEntry> {
  /** Stable group identifier — used as React key and for URL state */
  id: string;
  /** Human label for the group header */
  label: string;
  /** Optional secondary label (e.g., "Mon Apr 13") */
  sublabel?: string;
  /** Optional color dot for the group */
  color?: string;
  entries: T[];
  /** Sum of `duration_min` across completed entries */
  totalMin: number;
  /** Sum of `duration_min` for billable completed entries */
  billableMin: number;
  /** Customer identity (optional) — when set, the group renders with
   *  a customer-style header (CustomerChip + name + subtotal) and
   *  the rows beneath inherit `railColor`. Drives the unified
   *  customer-grouping visual across week / day views. */
  customerId?: string | null;
  isInternalCustomer?: boolean;
  /** Hashed AVATAR_PRESETS bg color for the customer — applied as a
   *  4px left rail on every row in the group so contiguous same-
   *  customer rows read as a connected vertical band. */
  railColor?: string | null;
}

export interface ProjectRef {
  id: string;
  name: string;
}

export interface CategoryRef {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

interface GroupingContext {
  projects: ProjectRef[];
  categories: CategoryRef[];
  /** Label used for entries that have no category assigned */
  uncategorizedLabel: string;
}

/**
 * Group entries by the chosen dimension, returning groups sorted sensibly:
 *   day      → chronological (earliest day first)
 *   category → by sort_order asc; uncategorized last
 *   project  → by project name A..Z
 */
export function groupEntries<T extends GroupableEntry>(
  entries: T[],
  kind: GroupingKind,
  ctx: GroupingContext,
): EntryGroup<T>[] {
  switch (kind) {
    case "day":
      return groupByDay(entries);
    case "category":
      return groupByCategory(entries, ctx);
    case "project":
      return groupByProject(entries, ctx);
  }
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupByDay<T extends GroupableEntry>(entries: T[]): EntryGroup<T>[] {
  const byDay = new Map<string, T[]>();
  for (const e of entries) {
    const key = dayKey(e.start_time);
    const list = byDay.get(key) ?? [];
    list.push(e);
    byDay.set(key, list);
  }
  const groups: EntryGroup<T>[] = [];
  for (const [key, list] of byDay) {
    // Sort entries chronologically within the day
    list.sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
    const first = new Date(list[0]!.start_time);
    const label = first.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sublabel = isSameDay(first, today) ? "Today" : undefined;
    groups.push({
      id: key,
      label,
      sublabel,
      entries: list,
      totalMin: sumDurationMin(list),
      billableMin: sumBillableMin(list),
    });
  }
  // Earliest day first
  groups.sort((a, b) => a.id.localeCompare(b.id));
  return groups;
}

function groupByCategory<T extends GroupableEntry>(
  entries: T[],
  ctx: GroupingContext,
): EntryGroup<T>[] {
  const byCat = new Map<string, T[]>();
  const uncategorized: T[] = [];
  for (const e of entries) {
    if (e.category_id) {
      const list = byCat.get(e.category_id) ?? [];
      list.push(e);
      byCat.set(e.category_id, list);
    } else {
      uncategorized.push(e);
    }
  }
  const groups: EntryGroup<T>[] = [];
  for (const [catId, list] of byCat) {
    const cat = ctx.categories.find((c) => c.id === catId);
    list.sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
    groups.push({
      id: catId,
      label: cat?.name ?? "—",
      color: cat?.color,
      entries: list,
      totalMin: sumDurationMin(list),
      billableMin: sumBillableMin(list),
    });
  }
  // Sort by category sort_order, unknown last
  groups.sort((a, b) => {
    const ca = ctx.categories.find((c) => c.id === a.id);
    const cb = ctx.categories.find((c) => c.id === b.id);
    const oa = ca?.sort_order ?? Number.MAX_SAFE_INTEGER;
    const ob = cb?.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.label.localeCompare(b.label);
  });
  if (uncategorized.length > 0) {
    uncategorized.sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
    groups.push({
      id: "__uncategorized__",
      label: ctx.uncategorizedLabel,
      entries: uncategorized,
      totalMin: sumDurationMin(uncategorized),
      billableMin: sumBillableMin(uncategorized),
    });
  }
  return groups;
}

function groupByProject<T extends GroupableEntry>(
  entries: T[],
  ctx: GroupingContext,
): EntryGroup<T>[] {
  const byProject = new Map<string, T[]>();
  for (const e of entries) {
    const list = byProject.get(e.project_id) ?? [];
    list.push(e);
    byProject.set(e.project_id, list);
  }
  const groups: EntryGroup<T>[] = [];
  for (const [pid, list] of byProject) {
    const p = ctx.projects.find((p) => p.id === pid);
    list.sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
    groups.push({
      id: pid,
      label: p?.name ?? "—",
      entries: list,
      totalMin: sumDurationMin(list),
      billableMin: sumBillableMin(list),
    });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}
