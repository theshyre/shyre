"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  Calendar,
  ListTree,
  Users,
  FolderKanban,
  CheckSquare,
} from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import { useFormAction } from "@/hooks/use-form-action";
import { useDirtyTitle } from "@/hooks/use-dirty-title";
import { SubmitButton } from "@/components/SubmitButton";
import {
  inputClass,
  textareaClass,
  labelClass,
  selectClass,
  formGridClass,
  formSpanFull,
  formSpanHalf,
  formSpanQuarter,
} from "@/lib/form-styles";
import { TeamSelector } from "@/components/TeamSelector";
import type { TeamListItem } from "@/lib/team-context";
import {
  groupEntriesIntoLineItems,
  type EntryCandidate,
} from "@/lib/invoice-grouping";
import { calculateInvoiceTotals } from "@/lib/invoice-utils";
import { formatCurrency } from "@/lib/invoice-utils";
import type { InvoiceGroupingMode } from "../allow-lists";
import { createInvoiceAction } from "../actions";

interface CustomerOption {
  id: string;
  name: string;
  default_rate: number | null;
}

/** Per-entry payload streamed to the client by `page.tsx`. The
 *  rate cascade (project → customer → member → team default) is
 *  resolved server-side so the preview's grouping can run on flat
 *  primitive data — no need to re-fetch projects / members. */
export interface PreviewCandidate extends EntryCandidate {
  /** customer_id of the entry's project — used for the customer
   *  filter in the preview. NULL for internal projects. */
  customerId: string | null;
  /** Team scope so the form can ignore entries from other teams when
   *  the user picks a specific team via the TeamSelector. */
  teamId: string;
}

type RangePreset =
  | "sinceLastInvoice"
  | "all"
  | "lastMonth"
  | "thisMonth"
  | "last30Days"
  | "custom";

const PRESETS: RangePreset[] = [
  "sinceLastInvoice",
  "all",
  "lastMonth",
  "thisMonth",
  "last30Days",
  "custom",
];

/** localStorage keys — preserve the user's last grouping + preset
 *  choice so a solo consultant who always invoices the same way
 *  doesn't re-pick every time. Per-customer persistence is a
 *  follow-up; global is a useful starting point. */
const STORAGE_GROUPING = "shyre.invoiceNew.grouping";
const STORAGE_PRESET = "shyre.invoiceNew.preset";

function loadStored<T extends string>(key: string, allowed: readonly T[]): T | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(key);
  return allowed.includes(v as T) ? (v as T) : null;
}

function fmtYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Day after a YYYY-MM-DD date string, in the same shape. Used
 *  to roll past a previous invoice's period_end so the new range
 *  doesn't double-count the boundary day. */
function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Compute (start, end) in YYYY-MM-DD for a preset. `custom` returns
 *  the inputs untouched so the date inputs win. `all` returns null/null
 *  so the preview pulls every uninvoiced entry. `sinceLastInvoice`
 *  resolves only when the selected customer has a prior invoice
 *  with a known period_end / issued_date — caller passes that in. */
function rangeForPreset(
  preset: RangePreset,
  custom: { start: string; end: string },
  today: Date,
  lastInvoiceEnd: string | null,
): { start: string | null; end: string | null } {
  switch (preset) {
    case "all":
      return { start: null, end: null };
    case "thisMonth": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: fmtYmd(start), end: fmtYmd(end) };
    }
    case "lastMonth": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: fmtYmd(start), end: fmtYmd(end) };
    }
    case "last30Days": {
      const end = new Date(today);
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { start: fmtYmd(start), end: fmtYmd(end) };
    }
    case "sinceLastInvoice": {
      // No prior invoice → fall through to "no upper bound, no
      // lower bound" so the preview shows every uninvoiced entry
      // and the user can still ship. Helper text in the UI
      // explains that the preset is "All" until the customer has
      // their first invoice.
      if (!lastInvoiceEnd) return { start: null, end: null };
      return { start: nextDay(lastInvoiceEnd), end: fmtYmd(today) };
    }
    case "custom":
      return {
        start: custom.start || null,
        end: custom.end || null,
      };
  }
}

const GROUPING_OPTIONS: {
  value: InvoiceGroupingMode;
  icon: React.ComponentType<{ size?: number }>;
}[] = [
  { value: "by_project", icon: FolderKanban },
  { value: "by_task", icon: CheckSquare },
  { value: "by_person", icon: Users },
  { value: "detailed", icon: ListTree },
];

export function NewInvoiceForm({
  customers,
  candidates,
  lastInvoiceEndByCustomer,
  defaultTaxRate,
  teams,
}: {
  customers: CustomerOption[];
  candidates: PreviewCandidate[];
  /** Map of customer_id → most-recent non-void / non-draft invoice's
   *  period_end (or issued_date fallback). Drives the
   *  "Since last invoice" preset. Empty when the customer hasn't
   *  been invoiced yet. */
  lastInvoiceEndByCustomer: Record<string, string>;
  defaultTaxRate: number;
  teams: TeamListItem[];
}): React.JSX.Element {
  const t = useTranslations("invoices");
  const tNew = useTranslations("invoices.new");

  const [dirty, setDirty] = useState(false);
  useDirtyTitle(dirty);

  const [customerId, setCustomerId] = useState<string>("");
  // Default to "sinceLastInvoice" — falls through to "all"
  // semantics when the customer has no prior invoice (the
  // preset's helper text explains this). Picked as default per the
  // user's stated workflow ("I use this all the time").
  const [preset, setPreset] = useState<RangePreset>("sinceLastInvoice");
  const [customRange, setCustomRange] = useState<{
    start: string;
    end: string;
  }>({ start: "", end: "" });
  const [grouping, setGrouping] = useState<InvoiceGroupingMode>("by_project");
  const [taxRate, setTaxRate] = useState<number>(defaultTaxRate);

  // Restore the user's last choices on mount. Reading localStorage
  // during render would mismatch hydration (server has no
  // localStorage); reading in an effect after mount is the
  // conventional pattern. The `react-hooks/set-state-in-effect`
  // rule fires on this — disabled with rationale, since the
  // state initializer can't see localStorage and the alternative
  // (lazy init) would cause hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect -- localStorage
     can't be read during render (no SSR) and lazy init would
     mismatch hydration — set after mount is the conventional
     pattern here. */
  useEffect(() => {
    const storedGrouping = loadStored<InvoiceGroupingMode>(
      STORAGE_GROUPING,
      ["by_task", "by_person", "by_project", "detailed"],
    );
    if (storedGrouping) setGrouping(storedGrouping);
    const storedPreset = loadStored<RangePreset>(STORAGE_PRESET, PRESETS);
    if (storedPreset) setPreset(storedPreset);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_GROUPING, grouping);
    }
  }, [grouping]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_PRESET, preset);
    }
  }, [preset]);

  const { pending, success, serverError, handleSubmit } = useFormAction({
    action: createInvoiceAction,
    onSuccess: () => setDirty(false),
  });

  // Resolve the actual range bounds from the preset, recomputed each
  // render so a stale "this month" doesn't haunt a user with the tab
  // open across midnight.
  const today = useMemo(() => new Date(), []);
  const lastInvoiceEnd = customerId
    ? (lastInvoiceEndByCustomer[customerId] ?? null)
    : null;
  const range = useMemo(
    () =>
      rangeForPreset(preset, customRange, today, lastInvoiceEnd),
    [preset, customRange, today, lastInvoiceEnd],
  );

  // Filter candidates → group → totals. All client-side; same logic
  // the server runs at submit, so the preview total === posted total.
  const filtered = useMemo(() => {
    return candidates.filter((c) => {
      if (customerId && c.customerId !== customerId) return false;
      if (range.start && c.date && c.date < range.start) return false;
      if (range.end && c.date && c.date > range.end) return false;
      return true;
    });
  }, [candidates, customerId, range.start, range.end]);

  const lines = useMemo(
    () => groupEntriesIntoLineItems(filtered, grouping),
    [filtered, grouping],
  );

  const totals = useMemo(
    () => calculateInvoiceTotals(lines, taxRate),
    [lines, taxRate],
  );

  // Inferred period bounds for display — even when "All" is picked,
  // the user wants to see what range their invoice will actually
  // cover (min/max of included entry dates).
  const inferredPeriod = useMemo(() => {
    const dates = filtered
      .map((c) => c.date)
      .filter((d) => d.length > 0)
      .sort();
    if (dates.length === 0) return null;
    return {
      start: dates[0]!,
      end: dates[dates.length - 1]!,
    };
  }, [filtered]);

  const totalHours = useMemo(
    () => filtered.reduce((sum, c) => sum + c.durationMin, 0) / 60,
    [filtered],
  );

  // Safety net: when a date filter is active for the selected customer,
  // count uninvoiced entries that the filter excludes — those are
  // typically orphans (forgotten entries from before the last
  // invoice's period_end). Surfaced as a warning so the user can
  // notice + widen if they want, instead of silently leaving money
  // on the table.
  const orphanedByFilter = useMemo(() => {
    if (!range.start && !range.end) return 0;
    return candidates.filter((c) => {
      if (customerId && c.customerId !== customerId) return false;
      if (range.start && c.date && c.date < range.start) return true;
      if (range.end && c.date && c.date > range.end) return true;
      return false;
    }).length;
  }, [candidates, customerId, range.start, range.end]);

  return (
    <form
      action={handleSubmit}
      onChange={() => {
        if (!dirty) setDirty(true);
      }}
      onInput={() => {
        if (!dirty) setDirty(true);
      }}
      className="mt-6"
    >
      {serverError && (
        <div className="mb-4">
          <AlertBanner tone="error">{serverError}</AlertBanner>
        </div>
      )}
      <TeamSelector teams={teams} />

      {/* Hidden inputs: the form's interactive controls are React-
          state-driven, but the action consumes FormData. Mirror state
          into hidden inputs so the action gets the canonical values. */}
      <input type="hidden" name="grouping_mode" value={grouping} />
      <input type="hidden" name="range_start" value={range.start ?? ""} />
      <input type="hidden" name="range_end" value={range.end ?? ""} />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Left column — configuration */}
        <div className="space-y-4">
          <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
            <div className={formGridClass}>
              <div className={formSpanHalf}>
                <label className={labelClass}>{t("selectClient")}</label>
                <select
                  autoFocus
                  name="customer_id"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">{t("allClients")}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={formSpanQuarter}>
                <label className={labelClass}>{t("fields.dueDate")}</label>
                <input name="due_date" type="date" className={inputClass} />
              </div>
              <div className={formSpanQuarter}>
                <label className={labelClass}>{t("fields.taxRate")}</label>
                <input
                  name="tax_rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={taxRate}
                  onChange={(e) =>
                    setTaxRate(Number(e.target.value) || 0)
                  }
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-accent" />
              <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
                {tNew("billableHours.heading")}
              </h2>
            </div>
            <div
              role="radiogroup"
              aria-label={tNew("billableHours.heading")}
              className="flex flex-wrap gap-1.5"
            >
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={preset === p}
                  onClick={() => setPreset(p)}
                  className={`rounded-md border px-3 py-1.5 text-body transition-colors ${
                    preset === p
                      ? "border-accent bg-accent-soft text-accent-text"
                      : "border-edge bg-surface text-content-secondary hover:border-edge-muted"
                  }`}
                >
                  {tNew(`billableHours.preset.${p}`)}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>
                    {tNew("billableHours.startDate")}
                  </label>
                  <input
                    type="date"
                    value={customRange.start}
                    onChange={(e) =>
                      setCustomRange((p) => ({ ...p, start: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    {tNew("billableHours.endDate")}
                  </label>
                  <input
                    type="date"
                    value={customRange.end}
                    onChange={(e) =>
                      setCustomRange((p) => ({ ...p, end: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            )}
            {preset === "sinceLastInvoice" && !customerId && (
              <p className="text-caption text-content-muted">
                {tNew("billableHours.sinceLastInvoice.pickCustomer")}
              </p>
            )}
            {preset === "sinceLastInvoice" && customerId && !lastInvoiceEnd && (
              <p className="text-caption text-content-muted">
                {tNew("billableHours.sinceLastInvoice.firstInvoice")}
              </p>
            )}
            {preset === "sinceLastInvoice" && lastInvoiceEnd && (
              <p className="text-caption text-content-muted">
                {tNew("billableHours.sinceLastInvoice.previousEnd", {
                  date: lastInvoiceEnd,
                })}
              </p>
            )}
            {range.start || range.end ? (
              <p className="text-caption text-content-muted">
                {tNew("billableHours.activeRange", {
                  start: range.start ?? "—",
                  end: range.end ?? "—",
                })}
              </p>
            ) : (
              <p className="text-caption text-content-muted">
                {tNew("billableHours.noRange")}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ListTree size={16} className="text-accent" />
              <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
                {tNew("grouping.heading")}
              </h2>
            </div>
            <div role="radiogroup" className="grid sm:grid-cols-2 gap-2">
              {GROUPING_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = grouping === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setGrouping(opt.value)}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-accent bg-accent-soft text-accent-text"
                        : "border-edge bg-surface hover:border-edge-muted"
                    }`}
                  >
                    <Icon size={14} />
                    <span>
                      <span className="block text-body font-medium">
                        {tNew(`grouping.${opt.value}.label`)}
                      </span>
                      <span className="block text-caption text-content-muted">
                        {tNew(`grouping.${opt.value}.help`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-edge bg-surface-raised p-4">
            <div className={formGridClass}>
              <div className={formSpanFull}>
                <label className={labelClass}>{t("fields.notes")}</label>
                <textarea
                  name="notes"
                  rows={3}
                  placeholder={t("fields.notesPlaceholder")}
                  className={textareaClass}
                />
              </div>
            </div>
          </section>

          <SubmitButton
            label={t("createInvoice")}
            pending={pending}
            success={success}
            disabled={lines.length === 0}
            icon={FileText}
          />
        </div>

        {/* Right rail — sticky live preview */}
        <aside className="lg:sticky lg:top-4 self-start rounded-lg border border-edge bg-surface-raised p-4 space-y-3">
          <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
            {tNew("preview.heading")}
          </h2>
          {lines.length === 0 ? (
            <div className="text-body text-content-muted">
              <p className="mb-1.5">{tNew("preview.empty.title")}</p>
              <p className="text-caption">
                {tNew("preview.empty.help")}
              </p>
              {(preset !== "all" || customerId) && (
                <button
                  type="button"
                  onClick={() => {
                    setPreset("all");
                    setCustomerId("");
                  }}
                  className="mt-2 text-caption text-accent hover:underline"
                >
                  {tNew("preview.empty.clearFilters")}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1.5 text-body">
                <div className="flex justify-between">
                  <span className="text-content-muted">
                    {tNew("preview.entries")}
                  </span>
                  <span className="font-mono tabular-nums">
                    {filtered.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-muted">
                    {tNew("preview.hours")}
                  </span>
                  <span className="font-mono tabular-nums">
                    {totalHours.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-muted">
                    {tNew("preview.lines")}
                  </span>
                  <span className="font-mono tabular-nums">
                    {lines.length}
                  </span>
                </div>
                {inferredPeriod && (
                  <div className="flex justify-between text-caption">
                    <span className="text-content-muted">
                      {tNew("preview.period")}
                    </span>
                    <span className="text-content-secondary">
                      {inferredPeriod.start} → {inferredPeriod.end}
                    </span>
                  </div>
                )}
              </div>

              {orphanedByFilter > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning-soft/30 p-2.5 text-caption text-content-secondary">
                  <p>
                    {tNew("preview.orphans.message", {
                      count: orphanedByFilter,
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPreset("all")}
                    className="mt-1 text-accent hover:underline"
                  >
                    {tNew("preview.orphans.switchToAll")}
                  </button>
                </div>
              )}
              <div className="border-t border-edge pt-3 space-y-1.5">
                <div className="flex justify-between text-body">
                  <span className="text-content-muted">
                    {t("fields.subtotal")}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(totals.subtotal)}
                  </span>
                </div>
                {taxRate > 0 && (
                  <div className="flex justify-between text-body">
                    <span className="text-content-muted">
                      {t("fields.taxAmount")} ({taxRate}%)
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(totals.taxAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-body-lg font-semibold">
                  <span>{t("fields.total")}</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(totals.total)}
                  </span>
                </div>
              </div>

              {/* Sample of the lines that will be created — first 5
                  with truncated descriptions; full list available
                  on the resulting invoice detail page. */}
              <div className="border-t border-edge pt-3 space-y-1">
                <p className="text-caption text-content-muted uppercase tracking-wider">
                  {tNew("preview.linesSample")}
                </p>
                {lines.slice(0, 5).map((line, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 text-caption"
                  >
                    <span className="truncate text-content-secondary">
                      {line.description}
                    </span>
                    <span className="font-mono tabular-nums text-content shrink-0">
                      {formatCurrency(line.amount)}
                    </span>
                  </div>
                ))}
                {lines.length > 5 && (
                  <p className="text-caption text-content-muted italic">
                    {tNew("preview.moreLines", { count: lines.length - 5 })}
                  </p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </form>
  );
}
