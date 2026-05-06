"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, useCallback, useState } from "react";
import { buttonGhostClass, labelClass } from "@/lib/form-styles";
import { DateField } from "@/components/DateField";
import type { ReportsPreset } from "./reports-period";

const PRESETS: ReadonlyArray<{ key: ReportsPreset; label: string }> = [
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "this_quarter", label: "This Quarter" },
  { key: "last_quarter", label: "Last Quarter" },
  { key: "this_year", label: "This Year" },
];

export function ReportsPeriodFilter({
  from,
  to,
  preset,
}: {
  from: string;
  to: string;
  preset: ReportsPreset;
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  const setPreset = useCallback(
    (next: ReportsPreset): void => {
      const sp = new URLSearchParams(params.toString());
      sp.set("preset", next);
      sp.delete("from");
      sp.delete("to");
      startTransition(() => {
        router.push(`?${sp.toString()}`);
      });
    },
    [params, router],
  );

  const setCustomRange = useCallback((): void => {
    if (!customFrom || !customTo) return;
    if (customFrom > customTo) return;
    const sp = new URLSearchParams(params.toString());
    sp.set("preset", "custom");
    sp.set("from", customFrom);
    sp.set("to", customTo);
    startTransition(() => {
      router.push(`?${sp.toString()}`);
    });
  }, [customFrom, customTo, params, router]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Date range presets">
        {PRESETS.map((p) => {
          const active = preset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={isPending}
              onClick={() => setPreset(p.key)}
              className={`${buttonGhostClass} ${active ? "bg-accent-soft text-accent-text border-accent" : ""}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2">
        <div>
          <label htmlFor="reports-from" className={labelClass}>
            From
          </label>
          <DateField
            id="reports-from"
            value={customFrom}
            onChange={setCustomFrom}
            ariaLabel="From date"
          />
        </div>
        <div>
          <label htmlFor="reports-to" className={labelClass}>
            To
          </label>
          <DateField
            id="reports-to"
            value={customTo}
            onChange={setCustomTo}
            ariaLabel="To date"
          />
        </div>
        <button
          type="button"
          onClick={setCustomRange}
          disabled={
            isPending ||
            !customFrom ||
            !customTo ||
            customFrom > customTo
          }
          className={buttonGhostClass}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
