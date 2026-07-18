"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { buttonGhostClass, labelClass } from "@/lib/form-styles";
import { DateField } from "@/components/DateField";
import type { ReportsPreset } from "./reports-period";

const PRESETS: ReadonlyArray<Exclude<ReportsPreset, "custom">> = [
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
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
  const t = useTranslations("reports");
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

  // Toggle-button group, not tabs: these rewrite a URL param over
  // server-rendered content — no tabpanel, no arrow-key roving focus,
  // so tab roles would announce semantics the page doesn't implement.
  // Buttons stay enabled during the transition (repeat pushes are
  // harmless; disabling would drop keyboard focus to <body>) — the
  // global <TopProgressBar /> covers pending feedback. Active state
  // carries ≥2 channels: accent tint + a real border (borders survive
  // forced-colors where tints flatten), on top of aria-pressed.
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div
        className={`flex flex-wrap gap-2 ${isPending ? "opacity-70" : ""}`}
        role="group"
        aria-label={t("periodFilter.presetsAria")}
      >
        {PRESETS.map((p) => {
          const active = preset === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => setPreset(p)}
              className={`${buttonGhostClass} border ${active ? "bg-accent-soft text-accent-text border-accent" : "border-transparent"}`}
            >
              {t(`periodFilter.${p}`)}
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2">
        <div>
          <label htmlFor="reports-from" className={labelClass}>
            {t("periodFilter.from")}
          </label>
          <DateField
            id="reports-from"
            value={customFrom}
            onChange={setCustomFrom}
            ariaLabel={t("periodFilter.fromAria")}
          />
        </div>
        <div>
          <label htmlFor="reports-to" className={labelClass}>
            {t("periodFilter.to")}
          </label>
          <DateField
            id="reports-to"
            value={customTo}
            onChange={setCustomTo}
            ariaLabel={t("periodFilter.toAria")}
          />
        </div>
        <button
          type="button"
          onClick={setCustomRange}
          disabled={!customFrom || !customTo || customFrom > customTo}
          className={buttonGhostClass}
        >
          {t("periodFilter.apply")}
        </button>
      </div>
    </div>
  );
}
