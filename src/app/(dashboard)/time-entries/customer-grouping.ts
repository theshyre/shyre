/**
 * Customer-grouping helper shared across the Day and Log views.
 *
 * Both views (and the Week view, via its own bespoke implementation
 * keyed on Row instead of TimeEntry) render time entries grouped by
 * customer. Keeping the bucketing logic in one place means the three
 * views render the same customer order, same chip color hash, same
 * Internal / no-customer fallback treatment — which is the parity
 * rule established for the time-entry views (see
 * `memory/feedback_time_views_parity.md`).
 *
 * The function returns `EntryGroup<TimeEntry>[]` populated with the
 * optional customer fields (`customerId`, `isInternalCustomer`,
 * `railColor`) that `entry-table.tsx`'s `GroupBlock` branches on to
 * render the customer-style sub-header + per-row rail.
 */

import type { EntryGroup } from "@/lib/time/grouping";
import { customerRailColor } from "@/components/CustomerChip";
import { sumBillableMin, sumDurationMin } from "@/lib/time/week";
import type { ProjectOption, TimeEntry } from "./types";

/** Translation strings injected by the caller so this stays
 *  framework-pure (no React / next-intl coupling). */
interface Labels {
  internal: string;
  noCustomer: string;
}

interface CustomerBucket {
  customerId: string | null;
  customerName: string | null;
  isInternal: boolean;
  entries: TimeEntry[];
}

/**
 * Group `entries` by customer (looked up via `projects[].customers`).
 * Sort order: named customers alpha → Internal → no-customer.
 *
 * Each returned `EntryGroup` carries:
 *   - `customerId` / `isInternalCustomer` — drives the chip choice
 *   - `railColor` — drives the 4px left rail on every child row
 *   - `entries` sorted chronologically by start_time
 *
 * Empty input → empty array. Callers should handle "no groups"
 * separately (e.g., the Log view renders an empty-day placeholder).
 */
export function groupEntriesByCustomer(
  entries: TimeEntry[],
  projects: ProjectOption[],
  labels: Labels,
): EntryGroup<TimeEntry>[] {
  if (entries.length === 0) return [];

  const byKey = new Map<string, CustomerBucket>();
  for (const e of entries) {
    const project = projects.find((p) => p.id === e.project_id);
    const customer = project?.customers ?? null;
    const isInternal = !customer && project?.is_internal === true;
    const key =
      customer?.id ?? (isInternal ? "__internal__" : "__no_customer__");
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        isInternal,
        entries: [],
      };
      byKey.set(key, bucket);
    }
    bucket.entries.push(e);
  }

  const buckets = Array.from(byKey.values()).sort((a, b) => {
    const rank = (x: CustomerBucket): number => {
      if (x.customerName) return 0;
      if (x.isInternal) return 1;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (a.customerName ?? "").localeCompare(b.customerName ?? "");
  });

  return buckets.map((b): EntryGroup<TimeEntry> => {
    const sorted = [...b.entries].sort(
      (a, c) =>
        new Date(a.start_time).getTime() - new Date(c.start_time).getTime(),
    );
    const label = b.customerName
      ? b.customerName
      : b.isInternal
        ? labels.internal
        : labels.noCustomer;
    // `var(--edge)` fallback so internal / no-customer rows still
    // get a visible rail without claiming a phantom identity hash.
    const rail = customerRailColor(b.customerId) ?? "var(--edge)";
    return {
      id: `cust:${b.customerId ?? (b.isInternal ? "__internal__" : "__no_customer__")}`,
      label,
      entries: sorted,
      totalMin: sumDurationMin(sorted),
      billableMin: sumBillableMin(sorted),
      customerId: b.customerId,
      isInternalCustomer: b.isInternal,
      railColor: rail,
    };
  });
}
